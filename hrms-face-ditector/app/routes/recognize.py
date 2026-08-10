from dataclasses import dataclass

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from ..config import Settings, get_settings
from ..deps import get_engine, get_gallery
from ..engine import FaceEngine
from ..errors import ServiceError, bad_image
from ..gallery import Candidate, GalleryStore
from ..imaging import decode_image
from ..quality import assess, is_ambiguous_frame
from ..schemas import CandidateOut, FaceQuality, RecognizeRequest, RecognizeResponse
from ..security import require_service_key

router = APIRouter(prefix="/v1", tags=["recognize"], dependencies=[Depends(require_service_key)])


@dataclass
class _FrameResult:
    index: int
    faces_detected: int
    reason: str
    quality: FaceQuality | None = None
    candidates: list[Candidate] | None = None

    @property
    def top_score(self) -> float:
        return self.candidates[0].score if self.candidates else -1.0


# Worst to best, used to report the most informative failure when no frame
# produced candidates — "you were too far away" beats "no face" for a person
# standing at a kiosk wondering what to do differently.
_REASON_RANK = {"NO_FACE": 0, "LOW_QUALITY": 1, "AMBIGUOUS_FRAME": 2}


@router.post("/recognize", response_model=RecognizeResponse)
async def recognize(
    payload: RecognizeRequest,
    engine: FaceEngine = Depends(get_engine),
    store: GalleryStore = Depends(get_gallery),
    settings: Settings = Depends(get_settings),
) -> RecognizeResponse:
    """Identify the person at the kiosk.

    A frame that cannot be read is not an error — it is the normal case of
    someone standing slightly wrong — so those come back 200 with `matched:
    false` and a reason the kiosk can turn into "step closer". Only genuine
    caller mistakes (bad payload, unsynced gallery) raise.

    Nothing here writes attendance. This service says who it thinks is at the
    camera and how confident it is; the backend owns the decision to punch.
    """
    min_score = payload.min_score if payload.min_score is not None else settings.match_threshold
    min_margin = payload.min_margin if payload.min_margin is not None else settings.match_margin
    thresholds = {"min_score": min_score, "min_margin": min_margin}

    gallery = store.get(payload.org_id)
    if gallery is None:
        raise ServiceError(
            409,
            "GALLERY_NOT_LOADED",
            f"No gallery loaded for org {payload.org_id}; push a full sync and retry",
            org_id=payload.org_id,
        )
    if payload.expected_version is not None and payload.expected_version != gallery.version:
        raise ServiceError(
            409,
            "GALLERY_STALE",
            "Loaded gallery is not the version the caller expected",
            org_id=payload.org_id,
            loaded_version=gallery.version,
            expected_version=payload.expected_version,
        )
    if gallery.users == 0:
        return RecognizeResponse(
            matched=False,
            reason="EMPTY_GALLERY",
            gallery_version=gallery.version,
            thresholds=thresholds,
        )

    frames = payload.frames()
    if len(frames) > settings.max_frames:
        raise bad_image(
            "TOO_MANY_FRAMES",
            f"{len(frames)} frames sent, limit is {settings.max_frames}",
            limit=settings.max_frames,
        )

    results = [
        await _evaluate_frame(frame, index, payload, engine, store, settings)
        for index, frame in enumerate(frames)
    ]

    scored = [r for r in results if r.candidates]
    if not scored:
        worst = min(results, key=lambda r: _REASON_RANK.get(r.reason, 99))
        return RecognizeResponse(
            matched=False,
            reason=worst.reason,  # type: ignore[arg-type]
            quality=worst.quality,
            frame_index=worst.index,
            faces_detected=worst.faces_detected,
            gallery_version=gallery.version,
            thresholds=thresholds,
        )

    # Best frame wins. With several frames of one person, the one where they
    # happened to be looking straight at the camera is the honest measurement.
    best_frame = max(scored, key=lambda r: r.top_score)
    candidates = best_frame.candidates or []
    best = candidates[0]
    runner_up = candidates[1] if len(candidates) > 1 else None
    margin = best.score - runner_up.score if runner_up else best.score

    if best.score < min_score:
        reason = "BELOW_THRESHOLD"
    elif margin < min_margin:
        # Two people scoring within a hair of each other means the model cannot
        # separate them today. Refuse and let them use the PIN fallback rather
        # than mark the wrong employee in or out.
        reason = "AMBIGUOUS_MATCH"
    else:
        reason = "MATCHED"

    return RecognizeResponse(
        matched=reason == "MATCHED",
        reason=reason,  # type: ignore[arg-type]
        best=CandidateOut(user_id=best.user_id, score=best.score),
        runner_up=CandidateOut(user_id=runner_up.user_id, score=runner_up.score) if runner_up else None,
        margin=margin,
        candidates=[CandidateOut(user_id=c.user_id, score=c.score) for c in candidates],
        quality=best_frame.quality,
        frame_index=best_frame.index,
        faces_detected=best_frame.faces_detected,
        gallery_version=gallery.version,
        thresholds=thresholds,
    )


async def _evaluate_frame(
    frame: str,
    index: int,
    payload: RecognizeRequest,
    engine: FaceEngine,
    store: GalleryStore,
    settings: Settings,
) -> _FrameResult:
    image = decode_image(frame, max_bytes=settings.max_image_bytes, max_dim=settings.max_image_dim)
    faces = await run_in_threadpool(engine.detect, image)

    if not faces:
        return _FrameResult(index=index, faces_detected=0, reason="NO_FACE")
    if is_ambiguous_frame(faces, settings):
        return _FrameResult(index=index, faces_detected=len(faces), reason="AMBIGUOUS_FRAME")

    face = faces[0]  # engine.detect sorts largest first
    quality = assess(image, face, settings, profile="recognize")
    if not quality.passed:
        return _FrameResult(
            index=index, faces_detected=len(faces), reason="LOW_QUALITY", quality=quality
        )

    candidates = store.search(payload.org_id, face.embedding, top_k=payload.top_k)
    return _FrameResult(
        index=index,
        faces_detected=len(faces),
        reason="MATCHED",
        quality=quality,
        candidates=candidates,
    )
