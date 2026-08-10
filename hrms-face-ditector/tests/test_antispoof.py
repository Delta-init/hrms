"""Anti-spoof model, when one has been fetched.

Skipped on a clone that has not run scripts/fetch_antispoof.py, because no
weights are committed. These check the wiring — that the models load, score in
the right range, and that a picture of a face reads as a picture — not the
model's accuracy on your camera. That has to be measured where the kiosk lives:
scripts/calibrate_antispoof.py.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import pytest

from app.antispoof import SpoofDetector, _parse_model_name
from app.config import Settings
from app.engine import FaceEngine

from .conftest import GROUP_PHOTO

MODEL_DIR = Path(__file__).resolve().parents[1] / "models" / "antispoof"

pytestmark = pytest.mark.skipif(
    not MODEL_DIR.is_dir() or not list(MODEL_DIR.glob("*.onnx")),
    reason="no anti-spoof models — run scripts/fetch_antispoof.py",
)


@pytest.fixture(scope="module")
def detector() -> SpoofDetector:
    settings = Settings(service_key="t" * 40, antispoof_dir=str(MODEL_DIR))
    loaded = SpoofDetector(settings)
    loaded.load()
    return loaded


def test_filename_carries_the_crop_scale():
    """The scale is part of the model, so it travels in the filename. Getting
    this wrong crops differently from training and quietly ruins the score."""
    assert _parse_model_name("2.7_80x80_MiniFASNetV2.onnx") == (80, 80, 2.7)
    assert _parse_model_name("4_0_0_80x80_MiniFASNetV1SE.onnx") == (80, 80, 4.0)
    assert _parse_model_name("nonsense.onnx") is None


def test_models_load(detector):
    assert detector.available
    assert len(detector.model_names) >= 1


def test_a_photograph_of_a_face_scores_as_one(detector, client):
    """The bundled group shot is a scan of a printed press photo — the camera
    looking at a picture, which is exactly the attack this is meant to catch."""
    engine: FaceEngine = client.app.state.engine
    image = cv2.imread(str(GROUP_PHOTO))
    faces = engine.detect(image)
    assert faces

    scores = [detector.score(image, face) for face in faces]
    assert all(s is not None for s in scores)
    assert all(0.0 <= s <= 1.0 for s in scores)
    # Every face in a photograph of a photograph should read as a spoof. If this
    # ever fails, the preprocessing has drifted from what the model expects —
    # channel order and crop scale are the usual culprits.
    assert all(s > 0.5 for s in scores), scores


def test_scoring_is_off_when_no_directory_is_set():
    quiet = SpoofDetector(Settings(service_key="t" * 40, antispoof_dir=""))
    quiet.load()
    assert quiet.available is False
    assert quiet.model_names == []
