from __future__ import annotations

import numpy as np

from .config import Settings
from .engine import DetectedFace
from .imaging import blur_score, brightness, crop_bbox
from .schemas import FaceQuality


def assess(
    image: np.ndarray,
    face: DetectedFace,
    settings: Settings,
    *,
    profile: str,
) -> FaceQuality:
    """Score a detected face against the gates for `profile`.

    Two profiles, because the two jobs have opposite failure costs:

    - "enroll" is strict. A blurry or badly-lit enrollment capture becomes a
      permanently weak template, quietly dragging that employee's match scores
      down for as long as it stays in the gallery.
    - "recognize" is lenient. Rejecting a slightly soft kiosk frame just makes
      someone stand there again, and the similarity threshold is already the
      real decision — a poor frame simply won't score high enough.
    """
    crop = crop_bbox(image, face.bbox)
    measured_blur = blur_score(crop)
    measured_brightness = brightness(crop)
    failures: list[str] = []

    if profile == "enroll":
        if face.det_score < settings.enroll_min_det_score:
            failures.append("LOW_DETECTION_CONFIDENCE")
        if face.size < settings.enroll_min_face_pixels:
            failures.append("FACE_TOO_SMALL")
        if measured_blur < settings.enroll_min_blur:
            failures.append("TOO_BLURRY")
        if measured_brightness < settings.enroll_min_brightness:
            failures.append("TOO_DARK")
        if measured_brightness > settings.enroll_max_brightness:
            failures.append("TOO_BRIGHT")
        if face.yaw is not None and abs(face.yaw) > settings.enroll_max_yaw:
            failures.append("HEAD_TURNED")
        if face.pitch is not None and abs(face.pitch) > settings.enroll_max_pitch:
            failures.append("HEAD_TILTED")
    else:
        if face.det_score < settings.recognize_min_det_score:
            failures.append("LOW_DETECTION_CONFIDENCE")
        if face.size < settings.recognize_min_face_pixels:
            failures.append("FACE_TOO_SMALL")

    return FaceQuality(
        det_score=face.det_score,
        face_pixels=face.size,
        blur=measured_blur,
        brightness=measured_brightness,
        yaw=face.yaw,
        pitch=face.pitch,
        roll=face.roll,
        passed=not failures,
        failures=failures,
    )


def is_ambiguous_frame(faces: list[DetectedFace], settings: Settings) -> bool:
    """True when a second face is nearly as prominent as the largest.

    Someone waiting behind the person punching in is normal, and their face is
    usually much smaller. When two faces are close to the same size we cannot
    tell who is at the kiosk, so we refuse the frame instead of picking one and
    marking the wrong employee present.
    """
    if len(faces) < 2:
        return False
    largest, second = faces[0].size, faces[1].size
    if largest <= 0:
        return True
    return (second / largest) >= settings.recognize_ambiguous_face_ratio
