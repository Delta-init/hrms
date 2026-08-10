from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import Settings
from .engine import DetectedFace

# Head-pose sign convention, established empirically against this model pack:
# a face whose nose points to the left of the frame — a head turned to the
# subject's own right — reports a negative yaw, and mirroring the image flips
# the sign. So:
#
#     yaw > 0  →  turned to the subject's LEFT
#     yaw < 0  →  turned to the subject's RIGHT
#
# The kiosk preview is mirrored for the person standing there, but the frame it
# uploads is not, so this convention is what the server sees. Worth confirming
# once on a real device during rollout — if prompts feel backwards, this is the
# single place that decides it.
TURN_SIGN: dict[str, int] = {"left": +1, "right": -1}

STEPS = ("center", "left", "right")


@dataclass(frozen=True)
class FrameObservation:
    """One uploaded frame, with whatever was found in it."""

    index: int
    face: DetectedFace | None
    thumbnail: np.ndarray | None  # small grayscale copy, for the identical-frame check


@dataclass
class LivenessVerdict:
    live: bool
    reason: str
    required: list[str]
    # Which frame satisfied each step, in order; None where nothing did.
    matched_frames: list[int | None]
    same_person: bool | None
    frame_difference: float | None
    spoof_score: float | None
    detail: str = ""


def observe(index: int, image: np.ndarray, face: DetectedFace | None) -> FrameObservation:
    """Reduce a frame to what liveness needs, so full images aren't held on."""
    small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (64, 64), interpolation=cv2.INTER_AREA)
    return FrameObservation(index=index, face=face, thumbnail=small.astype(np.float32))


def satisfies(step: str, face: DetectedFace, settings: Settings) -> bool:
    """Whether this face is holding the pose a step asks for."""
    if face.yaw is None or face.pitch is None:
        return False
    if step == "center":
        return abs(face.yaw) <= settings.liveness_center_max_yaw and abs(face.pitch) <= settings.liveness_center_max_pitch
    sign = TURN_SIGN.get(step)
    if sign is None:
        return False
    return face.yaw * sign >= settings.liveness_turn_min_yaw


def verify(
    observations: list[FrameObservation],
    steps: list[str],
    settings: Settings,
    spoof_score: float | None = None,
) -> LivenessVerdict:
    """
    Decide whether these frames show a live person following the prompts.

    The core signal is simply that the poses the server asked for, in the order
    it asked for them, actually happened. A photograph cannot turn its head, and
    neither can a still on a phone screen, so this alone defeats the attacks
    that matter most. It does not defeat a video of the right person doing the
    right sequence — a trained spoof model is what covers that, and it plugs in
    through `spoof_score`.
    """
    with_faces = [o for o in observations if o.face is not None]
    empty = LivenessVerdict(
        live=False, reason="", required=steps, matched_frames=[None] * len(steps),
        same_person=None, frame_difference=None, spoof_score=spoof_score,
    )

    if not with_faces:
        empty.reason = "NO_FACE_IN_FRAMES"
        return empty

    if any(o.face.yaw is None for o in with_faces):
        # The pose model did not run, so there is nothing to check a prompt
        # against. Failing closed here matters: reporting "live" because we
        # could not measure would make the whole challenge decorative.
        empty.reason = "POSE_UNAVAILABLE"
        return empty

    # Same person throughout — otherwise someone could hold up a photo of a
    # colleague for the frame that gets recognised and use their own face for
    # the poses.
    same_person, worst_pair = _same_person(with_faces, settings)
    if not same_person:
        empty.same_person = False
        empty.reason = "DIFFERENT_PEOPLE"
        empty.detail = f"lowest similarity between frames was {worst_pair:.2f}"
        return empty

    # One image uploaded several times. Cheap to check, and it catches the
    # laziest replay before any pose reasoning happens.
    difference = _frame_difference(observations)
    if difference is not None and difference < settings.liveness_min_frame_difference:
        empty.same_person = True
        empty.frame_difference = difference
        empty.reason = "IDENTICAL_FRAMES"
        return empty

    # The prompts must be satisfied in the order they were given.
    matched: list[int | None] = []
    cursor = -1
    for step in steps:
        found = next(
            (o.index for o in with_faces if o.index > cursor and satisfies(step, o.face, settings)),
            None,
        )
        matched.append(found)
        if found is None:
            return LivenessVerdict(
                live=False, reason="STEP_NOT_SEEN", required=steps, matched_frames=matched,
                same_person=True, frame_difference=difference, spoof_score=spoof_score,
                detail=f"never saw: {step}",
            )
        cursor = found

    if spoof_score is not None and spoof_score >= settings.antispoof_threshold:
        return LivenessVerdict(
            live=False, reason="SPOOF_DETECTED", required=steps, matched_frames=matched,
            same_person=True, frame_difference=difference, spoof_score=spoof_score,
        )

    return LivenessVerdict(
        live=True, reason="OK", required=steps, matched_frames=matched,
        same_person=True, frame_difference=difference, spoof_score=spoof_score,
    )


def _same_person(observations: list[FrameObservation], settings: Settings) -> tuple[bool, float]:
    """Lowest pairwise similarity between the faces in these frames."""
    if len(observations) < 2:
        return True, 1.0
    embeddings = np.vstack([o.face.embedding for o in observations])  # type: ignore[union-attr]
    similarities = embeddings @ embeddings.T
    # Ignore the diagonal, which is every face compared with itself.
    np.fill_diagonal(similarities, 1.0)
    worst = float(similarities.min())
    return worst >= settings.liveness_same_person_min, worst


def _frame_difference(observations: list[FrameObservation]) -> float | None:
    """Largest mean absolute difference between any two frames, 0-255."""
    thumbnails = [o.thumbnail for o in observations if o.thumbnail is not None]
    if len(thumbnails) < 2:
        return None
    return max(
        float(np.abs(a - b).mean())
        for i, a in enumerate(thumbnails)
        for b in thumbnails[i + 1 :]
    )
