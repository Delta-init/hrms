import time

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..deps import get_engine, get_gallery
from ..engine import FaceEngine
from ..gallery import GalleryStore
from ..schemas import GalleryState, HealthResponse

router = APIRouter(tags=["health"])

_STARTED_AT = time.time()


@router.get("/health", response_model=HealthResponse)
async def health(
    engine: FaceEngine = Depends(get_engine),
    gallery: GalleryStore = Depends(get_gallery),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    """Liveness plus enough state for the backend to notice a restart.

    Unauthenticated so pm2 and uptime checks can poll it. It exposes no
    biometric data — only counts and the org's own version strings.

    The backend should treat an empty `galleries` list as "this process lost its
    cache, re-push my embeddings".
    """
    return HealthResponse(
        status="ok" if engine.is_loaded else "loading",
        model_pack=settings.model_pack,
        model_loaded=engine.is_loaded,
        uptime_seconds=round(time.time() - _STARTED_AT, 3),
        galleries=[GalleryState(**summary) for summary in gallery.summaries()],
    )
