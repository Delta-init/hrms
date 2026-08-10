from fastapi import APIRouter, Depends, Query

from ..deps import get_gallery
from ..errors import ServiceError
from ..gallery import GalleryStore, OrgGallery
from ..schemas import GalleryReplaceRequest, GalleryState, GalleryUpsertRequest
from ..security import require_service_key

# GalleryNotLoaded / GalleryTooLarge / InvalidEmbedding raised below are turned
# into coded HTTP errors by the handlers registered in main.py.
router = APIRouter(
    prefix="/v1/gallery", tags=["gallery"], dependencies=[Depends(require_service_key)]
)


def _state(org_id: str, gallery: OrgGallery) -> GalleryState:
    return GalleryState(
        org_id=org_id,
        version=gallery.version,
        users=gallery.users,
        vectors=gallery.vectors,
        synced_at=gallery.synced_at,
    )


@router.get("/{org_id}", response_model=GalleryState)
async def get_gallery_state(org_id: str, store: GalleryStore = Depends(get_gallery)) -> GalleryState:
    gallery = store.get(org_id)
    if gallery is None:
        raise ServiceError(
            404, "GALLERY_NOT_LOADED", f"No gallery loaded for org {org_id}", org_id=org_id
        )
    return _state(org_id, gallery)


@router.put("/{org_id}", response_model=GalleryState)
async def replace_gallery(
    org_id: str,
    payload: GalleryReplaceRequest,
    store: GalleryStore = Depends(get_gallery),
) -> GalleryState:
    """Full sync. The backend calls this at its own startup, whenever /health
    shows this process has lost its cache, and after any bulk enrollment change."""
    gallery = store.replace(
        org_id, payload.version, [(e.user_id, e.embeddings) for e in payload.entries]
    )
    return _state(org_id, gallery)


@router.post("/{org_id}/entries", response_model=GalleryState)
async def upsert_entry(
    org_id: str,
    payload: GalleryUpsertRequest,
    store: GalleryStore = Depends(get_gallery),
) -> GalleryState:
    """Add or replace one employee's captures — the enroll-one-person path."""
    gallery = store.upsert(org_id, payload.version, payload.user_id, payload.embeddings)
    return _state(org_id, gallery)


@router.delete("/{org_id}/entries/{user_id}", response_model=GalleryState)
async def delete_entry(
    org_id: str,
    user_id: str,
    version: str = Query(min_length=1),
    store: GalleryStore = Depends(get_gallery),
) -> GalleryState:
    """Drop one employee — offboarding, or a withdrawal of biometric consent."""
    gallery = store.remove(org_id, version, user_id)
    return _state(org_id, gallery)


@router.delete("/{org_id}", status_code=204)
async def drop_gallery(org_id: str, store: GalleryStore = Depends(get_gallery)) -> None:
    store.drop(org_id)
