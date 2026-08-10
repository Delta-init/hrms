from dataclasses import dataclass

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from ..antispoof import SpoofDetector
from ..config import Settings, get_settings
from ..deps import get_engine, get_gallery, get_spoof_detector
from ..engine import DetectedFace, FaceEngine
from ..errors import ServiceError, bad_image
from ..gallery import Candidate, GalleryStore
from ..imaging import decode_image
from ..liveness import FrameObservation, observe, verify
from ..quality import assess, is_ambiguous_frame
from ..schemas import (
    CandidateOut, FaceQuality, LivenessResult, RecognizeRequest, RecognizeResponse,
)
from ..security import require_service_key

router = APIRouter(prefix="/v1", tags=["recognize"], dependencies=[Depends(require_service_key)])

NOT_REQUESTED = LivenessResult(live=False, reason="NOT_REQUESTED")


@dataclass
class _FrameResult:
    index: int
    faces_detected: int
    reason: str
    quality: FaceQuality | None = None
    candidates: list[Candidate] | None = None
    face: DetectedFace | None = None
    observation: FrameObservation | None = None
    spoof_score: float | None = None

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
    detector: SpoofDetector = Depends(get_spoof_detector),
    settings: Settings = Depends(get_settings),
) -> RecognizeResponse:
    """
    Identify the person at the kiosk, and — when asked — check they are really
    there.

    A frame that cannot be read is not an error; it is the normal case of
    someone standing slightly wrong, so those come back 200 with `matched:
    false` and a reason the kiosk can turn into "step closer". Only genuine
    caller mistakes (bad payload, unsynced gallery) raise.

    Recognition and liveness are reported separately and neither overrides the
    other. This service says who it saw and whether the prompts were followed;
    the backend decides whether that adds up to a punch.
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
            liveness=NOT_REQUESTED,
        )

    frames = payload.frames()
    if len(frames) > settings.max_frames:
        raise bad_image(
            "TOO_MANY_FRAMES",
            f"{len(frames)} frames sent, limit is {settings.max_frames}",
            limit=settings.max_frames,
        )

    results = [
        await _evaluate_frame(frame, index, payload, engine, store, detector, settings)
        for index, frame in enumerate(frames)
    ]

    liveness = _check_liveness(results, payload, settings)

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
            liveness=liveness,
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
        liveness=liveness,
    )


def _check_liveness(
    results: list[_FrameResult],
    payload: RecognizeRequest,
    settings: Settings,
) -> LivenessResult:
    if payload.liveness is None:
        return NOT_REQUESTED

    observations = [r.observation for r in results if r.observation is not None]
    # The worst frame decides. An attacker only needs one convincing frame to be
    # recognised from, so a single suspicious one is enough to refuse.
    scores = [r.spoof_score for r in results if r.spoof_score is not None]
    spoof_score = max(scores) if scores else None

    verdict = verify(observations, list(payload.liveness.steps), settings, spoof_score)
    return LivenessResult(
        live=verdict.live,
        reason=verdict.reason,  # type: ignore[arg-type]
        required=verdict.required,
        matched_frames=verdict.matched_frames,
        same_person=verdict.same_person,
        frame_difference=verdict.frame_difference,
        spoof_score=verdict.spoof_score,
        detail=verdict.detail,
    )


async def _evaluate_frame(
    frame: str,
    index: int,
    payload: RecognizeRequest,
    engine: FaceEngine,
    store: GalleryStore,
    detector: SpoofDetector,
    settings: Settings,
) -> _FrameResult:
    image = decode_image(frame, max_bytes=settings.max_image_bytes, max_dim=settings.max_image_dim)
    faces = await run_in_threadpool(engine.detect, image)

    # Recorded for every frame, including ones too poor to recognise from: a
    # turn far enough to fail the quality gate is exactly the frame the pose
    # challenge needs to see.
    largest = faces[0] if faces else None
    observation = observe(index, image, largest)

    result = _FrameResult(
        index=index,
        faces_detected=len(faces),
        reason="MATCHED",
        face=largest,
        observation=observation,
    )
    if payload.liveness is not None and largest is not None and detector.available:
        result.spoof_score = await run_in_threadpool(detector.score, image, largest)

    if not faces:
        result.reason = "NO_FACE"
        return result
    if is_ambiguous_frame(faces, settings):
        result.reason = "AMBIGUOUS_FRAME"
        return result

    face = faces[0]  # engine.detect sorts largest first
    quality = assess(image, face, settings, profile="recognize")
    result.quality = quality
    if not quality.passed:
        result.reason = "LOW_QUALITY"
        return result

    result.candidates = store.search(payload.org_id, face.embedding, top_k=payload.top_k)
    return result
