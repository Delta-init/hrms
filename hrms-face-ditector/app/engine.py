from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass

import numpy as np

from .config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DetectedFace:
    """One face found in a frame, with everything needed to judge and match it."""

    embedding: np.ndarray  # (512,) float32, L2-normalized
    bbox: tuple[float, float, float, float]
    det_score: float
    # Degrees, from the 3D landmark model. None if the landmark module is off.
    yaw: float | None
    pitch: float | None
    roll: float | None

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]

    @property
    def size(self) -> float:
        """Shortest bbox side, in pixels — our "is the face big enough" measure."""
        return min(self.width, self.height)


class FaceEngine:
    """Wraps InsightFace so the rest of the app never touches the model directly.

    ONNX Runtime sessions are thread-safe, but the InsightFace `FaceAnalysis`
    wrapper keeps mutable per-call state, so detection is serialised behind a
    lock. Kiosk traffic is a handful of punches a minute, so the lock costs
    nothing; a queue of frames is far cheaper than a race in the model wrapper.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._app = None
        self._lock = threading.Lock()
        self._loaded_at: float | None = None

    @property
    def is_loaded(self) -> bool:
        return self._app is not None

    @property
    def loaded_at(self) -> float | None:
        return self._loaded_at

    def load(self) -> None:
        """Load the model pack. Downloads it on first run (~300 MB)."""
        if self._app is not None:
            return

        threads = self._settings.ort_threads
        if threads > 0:
            # ORT reads these at session-creation time, so they must be set
            # before the first model is constructed below.
            os.environ.setdefault("OMP_NUM_THREADS", str(threads))
            os.environ.setdefault("ORT_NUM_THREADS", str(threads))

        from insightface.app import FaceAnalysis  # imported late: pulls in ORT

        started = time.monotonic()
        app = FaceAnalysis(
            name=self._settings.model_pack,
            root=self._settings.model_root,
            # Skip gender/age and the 2D landmark model — we need detection,
            # recognition, and 3D landmarks (for head pose) and nothing else.
            allowed_modules=["detection", "recognition", "landmark_3d_68"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(
            ctx_id=-1,  # CPU
            det_thresh=self._settings.det_thresh,
            det_size=(self._settings.det_size, self._settings.det_size),
        )
        self._app = app
        self._loaded_at = time.time()
        logger.info(
            "Loaded model pack %s in %.1fs (det_size=%d)",
            self._settings.model_pack,
            time.monotonic() - started,
            self._settings.det_size,
        )

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        """Detect every face in a BGR frame, largest first."""
        if self._app is None:
            raise RuntimeError("FaceEngine.load() has not been called")

        with self._lock:
            faces = self._app.get(image)

        detected = [self._to_detected(face) for face in faces]
        detected.sort(key=lambda f: f.size, reverse=True)
        return detected

    @staticmethod
    def _to_detected(face) -> DetectedFace:
        bbox = [float(v) for v in face.bbox]
        # insightface stores pose as [pitch, yaw, roll] in degrees, and only
        # when the 3D landmark model ran.
        pose = face.get("pose") if hasattr(face, "get") else None
        pitch, yaw, roll = (None, None, None)
        if pose is not None and len(pose) == 3:
            pitch, yaw, roll = (float(pose[0]), float(pose[1]), float(pose[2]))

        embedding = np.asarray(face.normed_embedding, dtype=np.float32)
        return DetectedFace(
            embedding=embedding,
            bbox=(bbox[0], bbox[1], bbox[2], bbox[3]),
            det_score=float(face.det_score),
            yaw=yaw,
            pitch=pitch,
            roll=roll,
        )


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    """Return the unit-length version of a vector, so dot product == cosine."""
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("Cannot normalize a zero vector")
    return (vector / norm).astype(np.float32)
