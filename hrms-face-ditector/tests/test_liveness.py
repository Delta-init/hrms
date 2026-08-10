"""Liveness: the pose challenge and the attacks it exists to stop.

Split deliberately. The attack cases go over HTTP, because the bundled photos
are people at fixed angles — which is exactly what a printed photo held up to a
kiosk is, so they are honest stand-ins. The pose and ordering logic is tested
directly with constructed faces, because no photo set here contains one person
turning their head, and faking that with a warp would test the warp rather than
the rule.
"""

from __future__ import annotations

import base64

import cv2
import insightface
import numpy as np
import pytest

from app.config import get_settings
from app.engine import DetectedFace
from app.liveness import FrameObservation, satisfies, verify

from .conftest import GROUP_PHOTO, blank_frame, encode

ORG = "org_live"


@pytest.fixture(scope="module")
def gallery(client, auth, known_face):
    """One enrolled person, so recognition has somebody to find."""
    embedding = client.post("/v1/embed", json={"image": known_face}, headers=auth).json()["faces"][0][
        "embedding"
    ]
    client.put(
        f"/v1/gallery/{ORG}",
        json={"version": "v1", "entries": [{"user_id": "emp_live", "embeddings": [embedding]}]},
        headers=auth,
    )
    return embedding


def recognise(client, auth, images, steps=None):
    body: dict = {"org_id": ORG, "images": images}
    if steps is not None:
        body["liveness"] = {"steps": steps}
    return client.post("/v1/recognize", json=body, headers=auth).json()


def face(*, yaw: float | None, pitch: float = 0.0, embedding: np.ndarray | None = None) -> DetectedFace:
    vector = embedding if embedding is not None else np.zeros(512, dtype=np.float32)
    if embedding is None:
        vector[0] = 1.0
    return DetectedFace(
        embedding=vector, bbox=(0.0, 0.0, 200.0, 200.0), det_score=0.9,
        yaw=yaw, pitch=pitch, roll=0.0,
    )


def observation(index: int, f: DetectedFace | None, seed: int = 0) -> FrameObservation:
    # Thumbnails differ per frame so the identical-frame guard doesn't fire in
    # tests that are about something else.
    thumb = np.full((64, 64), float(seed * 40 % 255), dtype=np.float32)
    return FrameObservation(index=index, face=f, thumbnail=thumb)


# ─── the sign convention ──────────────────────────────────────────────────────


def test_positive_yaw_is_the_subjects_left():
    settings = get_settings()
    assert satisfies("left", face(yaw=25.0), settings) is True
    assert satisfies("right", face(yaw=25.0), settings) is False
    assert satisfies("right", face(yaw=-25.0), settings) is True
    assert satisfies("left", face(yaw=-25.0), settings) is False


def test_the_convention_matches_a_real_turned_head(client):
    """Ties the constant to reality.

    The most strongly turned face in the bundled group photo has its nose
    pointing to the left of the frame — a head turned to that person's own
    right — and reports a negative yaw. If a future model pack flips this, this
    test fails rather than the kiosk quietly asking for the wrong direction.
    """
    engine = client.app.state.engine
    image = cv2.imread(str(GROUP_PHOTO))
    turned = min(engine.detect(image), key=lambda f: f.yaw or 0.0)
    assert turned.yaw is not None and turned.yaw < -30
    assert satisfies("right", turned, get_settings()) is True
    assert satisfies("left", turned, get_settings()) is False


def test_a_centred_face_satisfies_center_and_nothing_else():
    settings = get_settings()
    centred = face(yaw=3.0, pitch=5.0)
    assert satisfies("center", centred, settings) is True
    assert satisfies("left", centred, settings) is False
    assert satisfies("right", centred, settings) is False


# ─── ordering ─────────────────────────────────────────────────────────────────


def test_prompts_must_be_followed_in_order():
    settings = get_settings()
    # Centre first, then a turn to the left — as prompted.
    frames = [observation(0, face(yaw=1.0), 1), observation(1, face(yaw=30.0), 2)]
    assert verify(frames, ["center", "left"], settings).live is True

    # The same two frames cannot satisfy the prompts in the other order: the
    # turn would have to come before the centre, and it doesn't. Without this,
    # the order carries no information and a replay is free.
    reversed_verdict = verify(frames, ["left", "center"], settings)
    assert reversed_verdict.live is False
    assert reversed_verdict.reason == "STEP_NOT_SEEN"


def test_one_frame_cannot_satisfy_two_prompts():
    settings = get_settings()
    frames = [observation(0, face(yaw=30.0), 1)]
    verdict = verify(frames, ["left", "left"], settings)
    assert verdict.live is False
    assert verdict.reason == "STEP_NOT_SEEN"


def test_a_missing_prompt_names_itself():
    settings = get_settings()
    frames = [observation(0, face(yaw=1.0), 1), observation(1, face(yaw=2.0), 2)]
    verdict = verify(frames, ["center", "right"], settings)
    assert verdict.reason == "STEP_NOT_SEEN"
    assert "right" in verdict.detail


def test_missing_pose_fails_closed():
    """If the pose model didn't run there is nothing to check a prompt against,
    and calling that 'live' would make the whole challenge decorative."""
    settings = get_settings()
    verdict = verify([observation(0, face(yaw=None), 1)], ["center"], settings)
    assert verdict.live is False
    assert verdict.reason == "POSE_UNAVAILABLE"


def test_a_configured_spoof_score_can_veto_a_good_sequence(monkeypatch):
    settings = get_settings()
    frames = [observation(0, face(yaw=1.0), 1), observation(1, face(yaw=30.0), 2)]
    assert verify(frames, ["center", "left"], settings).live is True
    vetoed = verify(frames, ["center", "left"], settings, spoof_score=0.99)
    assert vetoed.live is False
    assert vetoed.reason == "SPOOF_DETECTED"


# ─── the attacks, over HTTP ───────────────────────────────────────────────────


def test_liveness_is_not_claimed_when_not_asked_for(client, auth, known_face, gallery):
    body = recognise(client, auth, [known_face])
    assert body["liveness"]["reason"] == "NOT_REQUESTED"
    # Crucially not reported as live: the backend must never be able to read a
    # check that never ran as one that passed.
    assert body["liveness"]["live"] is False


def test_one_photo_repeated_is_refused(client, auth, known_face, gallery):
    """A still held up to the camera: the same frame, over and over."""
    body = recognise(client, auth, [known_face] * 4, steps=["center", "left"])
    assert body["liveness"]["live"] is False
    assert body["liveness"]["reason"] == "IDENTICAL_FRAMES"
    # It still recognises them, and that is the point — recognition succeeds,
    # liveness refuses, and a punch needs both.
    assert body["matched"] is True


def test_a_photo_that_never_turns_is_refused(client, auth, known_face, gallery):
    """Frames that differ slightly but show no head turn — a photo being
    jiggled in front of the lens."""
    raw = cv2.imdecode(np.frombuffer(base64.b64decode(known_face), np.uint8), cv2.IMREAD_COLOR)
    frames = [
        known_face,
        encode(cv2.convertScaleAbs(raw, alpha=1.15, beta=8)),
        encode(cv2.GaussianBlur(raw, (5, 5), 0)),
    ]
    body = recognise(client, auth, frames, steps=["center", "left"])
    assert body["liveness"]["live"] is False
    assert body["liveness"]["reason"] == "STEP_NOT_SEEN"
    assert "left" in body["liveness"]["detail"]


def test_swapping_in_someone_else_is_refused(client, auth, known_face, other_face, gallery):
    """A colleague's photo for the frame that gets recognised, your own face
    for the poses."""
    body = recognise(client, auth, [known_face, other_face], steps=["center"])
    assert body["liveness"]["live"] is False
    assert body["liveness"]["reason"] == "DIFFERENT_PEOPLE"
    assert body["liveness"]["same_person"] is False


def test_no_face_at_all_is_refused(client, auth, gallery):
    body = recognise(client, auth, [blank_frame(), blank_frame()], steps=["center"])
    assert body["liveness"]["live"] is False
    assert body["liveness"]["reason"] == "NO_FACE_IN_FRAMES"


def test_a_frontal_frame_satisfies_center(client, auth, known_face, gallery):
    body = recognise(client, auth, [known_face], steps=["center"])
    assert body["liveness"]["reason"] == "OK", body["liveness"]
    assert body["liveness"]["live"] is True
    assert body["liveness"]["matched_frames"] == [0]


def test_health_reports_when_no_spoof_model_is_loaded(client):
    """Health must state plainly that spoof scoring is not in play, so nothing
    downstream assumes a protection that was never loaded."""
    body = client.get("/health").json()
    assert body["antispoof_loaded"] is False
    assert body["antispoof_models"] == []
