from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .antispoof import SpoofDetector
from .config import get_settings
from .engine import FaceEngine
from .gallery import GalleryNotLoaded, GalleryStore, GalleryTooLarge, InvalidEmbedding
from .routes import embed, gallery, health, recognize

logger = logging.getLogger("face")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    engine = FaceEngine(settings)
    # Loaded synchronously: the service should not accept traffic before it can
    # answer. First run also downloads the model pack, so run scripts/warm.py
    # during deploy to keep restarts fast.
    engine.load()

    spoof = SpoofDetector(settings)
    spoof.load()

    app.state.engine = engine
    app.state.gallery = GalleryStore(max_vectors=settings.max_gallery_vectors)
    app.state.spoof = spoof
    logger.info(
        "Face service ready on %s:%d (spoof model: %s)",
        settings.host,
        settings.port,
        "loaded" if spoof.available else "none — pose challenge only",
    )
    yield


app = FastAPI(
    title="HRMS Face Detector",
    version="0.1.0",
    summary="Face enrollment and 1:N recognition for kiosk attendance",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(embed.router)
app.include_router(gallery.router)
app.include_router(recognize.router)


def _error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message, **extra})


@app.exception_handler(HTTPException)
async def _http_exception(_: Request, exc: HTTPException) -> JSONResponse:
    """Flatten errors to a bare `{code, message, ...}` body.

    FastAPI would wrap our detail dict in another `detail` key; the backend
    reads `code` off the top level, so unwrap it once here rather than teaching
    the Node client about two shapes.
    """
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return _error(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    # errors() can carry the original exception object in `ctx`, which json
    # cannot serialise — jsonable_encoder turns those into strings.
    return _error(
        422,
        "VALIDATION_ERROR",
        "Request body failed validation",
        errors=jsonable_encoder(exc.errors()),
    )


@app.exception_handler(GalleryNotLoaded)
async def _gallery_not_loaded(_: Request, exc: GalleryNotLoaded) -> JSONResponse:
    return _error(409, "GALLERY_NOT_LOADED", str(exc), org_id=exc.org_id)


@app.exception_handler(GalleryTooLarge)
async def _gallery_too_large(_: Request, exc: GalleryTooLarge) -> JSONResponse:
    return _error(413, "GALLERY_TOO_LARGE", str(exc), vectors=exc.vectors, limit=exc.limit)


@app.exception_handler(InvalidEmbedding)
async def _invalid_embedding(_: Request, exc: InvalidEmbedding) -> JSONResponse:
    return _error(422, "INVALID_EMBEDDING", str(exc))


def run() -> None:
    """Entry point for `python -m app.main` and for local development."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        # One worker only: the gallery lives in this process's memory, so a
        # second worker would serve recognitions against an empty cache.
        workers=1,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    run()
