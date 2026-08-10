from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from ..config import Settings, get_settings
from ..deps import get_engine
from ..engine import FaceEngine
from ..errors import bad_image
from ..imaging import decode_image
from ..quality import assess
from ..schemas import EmbedFace, EmbedRequest, EmbedResponse, FaceBox
from ..security import require_service_key

router = APIRouter(prefix="/v1", tags=["embed"], dependencies=[Depends(require_service_key)])


@router.post("/embed", response_model=EmbedResponse)
async def embed(
    payload: EmbedRequest,
    engine: FaceEngine = Depends(get_engine),
    settings: Settings = Depends(get_settings),
) -> EmbedResponse:
    """Turn enrollment captures into embeddings.

    Every frame must contain exactly one face that clears the strict enrollment
    gates; the first failure aborts the request with the frame index, so the
    admin UI can point at the capture that needs redoing. Partial success would
    be worse: an enrollment silently short one good angle is exactly the kind of
    weak profile that produces mystery mismatches months later.
    """
    frames = payload.frames()
    if len(frames) > settings.max_frames:
        raise bad_image(
            "TOO_MANY_FRAMES",
            f"{len(frames)} frames sent, limit is {settings.max_frames}",
            limit=settings.max_frames,
        )

    results: list[EmbedFace] = []
    for index, frame in enumerate(frames):
        image = decode_image(
            frame, max_bytes=settings.max_image_bytes, max_dim=settings.max_image_dim
        )
        faces = await run_in_threadpool(engine.detect, image)

        if not faces:
            raise bad_image("NO_FACE", "No face found in the frame", frame_index=index)
        if len(faces) > 1:
            raise bad_image(
                "MULTIPLE_FACES",
                "Enrollment needs a frame with exactly one face",
                frame_index=index,
                faces_detected=len(faces),
            )

        face = faces[0]
        quality = assess(image, face, settings, profile="enroll")
        if not quality.passed:
            raise bad_image(
                "LOW_QUALITY",
                "Capture did not meet enrollment quality requirements",
                frame_index=index,
                failures=quality.failures,
                quality=quality.model_dump(),
            )

        results.append(
            EmbedFace(
                embedding=face.embedding.tolist(),
                bbox=FaceBox(x1=face.bbox[0], y1=face.bbox[1], x2=face.bbox[2], y2=face.bbox[3]),
                quality=quality,
            )
        )

    return EmbedResponse(faces=results, model_pack=settings.model_pack)
