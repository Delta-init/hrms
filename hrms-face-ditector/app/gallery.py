from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Candidate:
    user_id: str
    score: float


@dataclass
class OrgGallery:
    """Every enrolled embedding for one organization, as one matrix.

    Rows are L2-normalized, so `matrix @ query` is cosine similarity in a single
    BLAS call. At 2,000 employees x 5 captures that is a 10,000 x 512 float32
    matrix — 20 MB and a sub-millisecond search. A vector database would buy us
    nothing at this scale.
    """

    version: str
    user_ids: list[str]  # distinct users, index-aligned with `owner_index` values
    owner_index: np.ndarray  # (N,) int32 — which user each row belongs to
    matrix: np.ndarray  # (N, 512) float32, rows L2-normalized
    synced_at: float

    @property
    def vectors(self) -> int:
        return int(self.matrix.shape[0])

    @property
    def users(self) -> int:
        return len(self.user_ids)


class GalleryNotLoaded(Exception):
    """Raised when an org's embeddings have not been pushed to this process."""

    def __init__(self, org_id: str) -> None:
        super().__init__(f"No gallery loaded for org {org_id}")
        self.org_id = org_id


class GalleryTooLarge(Exception):
    def __init__(self, vectors: int, limit: int) -> None:
        super().__init__(f"Gallery has {vectors} vectors, limit is {limit}")
        self.vectors = vectors
        self.limit = limit


class InvalidEmbedding(Exception):
    """A submitted vector is the wrong shape or unusable."""


class GalleryStore:
    """In-memory, per-organization embedding store.

    Deliberately not persisted: embeddings live in MongoDB on the Node side,
    and this process is a cache in front of them. On restart the store is empty
    and `search` raises `GalleryNotLoaded`, which tells the backend to re-push.
    That one signal keeps the two sides in sync without a shared database.
    """

    def __init__(self, *, dim: int = 512, max_vectors: int = 50_000) -> None:
        self._dim = dim
        self._max_vectors = max_vectors
        self._lock = threading.RLock()
        self._orgs: dict[str, OrgGallery] = {}

    # -- reads ----------------------------------------------------------------

    def get(self, org_id: str) -> OrgGallery | None:
        with self._lock:
            return self._orgs.get(org_id)

    def summaries(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "org_id": org_id,
                    "version": gallery.version,
                    "users": gallery.users,
                    "vectors": gallery.vectors,
                    "synced_at": gallery.synced_at,
                }
                for org_id, gallery in self._orgs.items()
            ]

    def search(self, org_id: str, query: np.ndarray, top_k: int = 3) -> list[Candidate]:
        """Best-scoring users for a query embedding, highest first.

        A user with several enrolled captures scores as their single best
        capture — an employee should match whichever of their enrollment poses
        is closest to how they are standing right now, not the average of them.
        """
        with self._lock:
            gallery = self._orgs.get(org_id)
            if gallery is None:
                raise GalleryNotLoaded(org_id)
            matrix = gallery.matrix
            owner_index = gallery.owner_index
            user_ids = gallery.user_ids

        similarities = matrix @ query.astype(np.float32)
        per_user = np.full(len(user_ids), -1.0, dtype=np.float32)
        np.maximum.at(per_user, owner_index, similarities)

        k = min(top_k, len(user_ids))
        top = np.argpartition(-per_user, k - 1)[:k] if k < len(user_ids) else np.arange(len(user_ids))
        top = top[np.argsort(-per_user[top])]
        return [Candidate(user_id=user_ids[i], score=float(per_user[i])) for i in top]

    # -- writes ---------------------------------------------------------------

    def replace(self, org_id: str, version: str, entries: list[tuple[str, list[list[float]]]]) -> OrgGallery:
        """Swap in a whole organization's gallery."""
        rows: list[np.ndarray] = []
        owners: list[int] = []
        user_ids: list[str] = []

        for user_id, embeddings in entries:
            if not embeddings:
                continue
            user_ids.append(user_id)
            owner = len(user_ids) - 1
            for embedding in embeddings:
                rows.append(self._as_row(embedding, user_id))
                owners.append(owner)

        if len(rows) > self._max_vectors:
            raise GalleryTooLarge(len(rows), self._max_vectors)

        gallery = OrgGallery(
            version=version,
            user_ids=user_ids,
            owner_index=np.asarray(owners, dtype=np.int32),
            matrix=(
                np.vstack(rows).astype(np.float32)
                if rows
                else np.zeros((0, self._dim), dtype=np.float32)
            ),
            synced_at=time.time(),
        )
        with self._lock:
            self._orgs[org_id] = gallery
        return gallery

    def upsert(
        self, org_id: str, version: str, user_id: str, embeddings: list[list[float]]
    ) -> OrgGallery:
        """Add or replace one user's captures without re-pushing the whole org."""
        with self._lock:
            gallery = self._orgs.get(org_id)
            if gallery is None:
                raise GalleryNotLoaded(org_id)
            entries = self._to_entries(gallery)
        entries = [(uid, vecs) for uid, vecs in entries if uid != user_id]
        if embeddings:
            entries.append((user_id, embeddings))
        return self.replace(org_id, version, entries)

    def remove(self, org_id: str, version: str, user_id: str) -> OrgGallery:
        return self.upsert(org_id, version, user_id, [])

    def drop(self, org_id: str) -> bool:
        with self._lock:
            return self._orgs.pop(org_id, None) is not None

    # -- helpers --------------------------------------------------------------

    def _as_row(self, embedding: list[float], user_id: str) -> np.ndarray:
        vector = np.asarray(embedding, dtype=np.float32)
        if vector.shape != (self._dim,):
            raise InvalidEmbedding(
                f"User {user_id}: expected a {self._dim}-d embedding, got {tuple(vector.shape)}"
            )
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(norm) or norm == 0.0:
            raise InvalidEmbedding(f"User {user_id}: embedding is all zeros or non-finite")
        # Re-normalize on the way in. The vectors we hand out are already unit
        # length, but a round-trip through JSON and MongoDB can shave the last
        # decimal, and the dot product is only cosine similarity if this holds.
        return vector / norm

    @staticmethod
    def _to_entries(gallery: OrgGallery) -> list[tuple[str, list[list[float]]]]:
        entries: list[tuple[str, list[list[float]]]] = []
        for index, user_id in enumerate(gallery.user_ids):
            rows = gallery.matrix[gallery.owner_index == index]
            entries.append((user_id, [row.tolist() for row in rows]))
        return entries
