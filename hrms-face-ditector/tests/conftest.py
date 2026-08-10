"""Shared fixtures.

The tests use the face photos bundled with insightface rather than any employee
data, so the suite runs on a fresh clone without shipping biometric samples.

Those samples are ~110px faces at awkward angles — below the enrollment gates
this service ships with, and rightly so. The environment below relaxes the
enrollment profile for the test run only; production keeps the strict defaults
from .env.example. This must happen before anything imports app.config, whose
settings are cached on first read.
"""

from __future__ import annotations

import os

os.environ["FACE_SERVICE_KEY"] = "test-key-" + "0" * 40
os.environ["FACE_ENROLL_MIN_FACE_PIXELS"] = "60"
os.environ["FACE_ENROLL_MIN_BLUR"] = "10"
os.environ["FACE_ENROLL_MAX_YAW"] = "90"
os.environ["FACE_ENROLL_MAX_PITCH"] = "90"
os.environ["FACE_RECOGNIZE_MIN_FACE_PIXELS"] = "60"

import base64  # noqa: E402
from pathlib import Path  # noqa: E402

import cv2  # noqa: E402
import insightface  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402

IMAGE_DIR = Path(insightface.__file__).parent / "data" / "images"
GROUP_PHOTO = IMAGE_DIR / "t1.jpg"
# A 112x112 pre-aligned crop — too tightly cropped for the detector to find a
# face at all, which makes it a good "unusable capture" sample.
TINY_FACE = IMAGE_DIR / "Tom_Hanks_54745.png"


def encode(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return base64.b64encode(buffer.tobytes()).decode()


def encode_file(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def blank_frame() -> str:
    return encode(np.zeros((480, 640, 3), dtype=np.uint8))


@pytest.fixture(scope="session")
def client():
    # Entering the context runs the lifespan, which loads the model pack once
    # for the whole session — about 10s, versus 10s per test otherwise.
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def auth() -> dict[str, str]:
    return {"X-Face-Service-Key": get_settings().service_key}


@pytest.fixture(scope="session")
def _cropped_faces(client) -> list[str]:
    """Single-face crops of two different people from the bundled group photo.

    Sorted by how square-on they are, since a face turned 50 degrees away is a
    poor stand-in for someone looking at a kiosk camera.
    """
    engine = client.app.state.engine
    image = cv2.imread(str(GROUP_PHOTO))
    faces = engine.detect(image)
    assert len(faces) >= 2, "expected the bundled group photo to contain several faces"
    facing_camera = sorted(faces, key=lambda f: abs(f.yaw or 0.0))

    crops = []
    height, width = image.shape[:2]
    for face in facing_camera[:2]:
        x1, y1, x2, y2 = face.bbox
        pad_x, pad_y = (x2 - x1) * 0.4, (y2 - y1) * 0.4
        crops.append(
            encode(
                image[
                    max(0, int(y1 - pad_y)) : min(height, int(y2 + pad_y)),
                    max(0, int(x1 - pad_x)) : min(width, int(x2 + pad_x)),
                ]
            )
        )
    return crops


@pytest.fixture(scope="session")
def known_face(_cropped_faces) -> str:
    """The person we enroll."""
    return _cropped_faces[0]


@pytest.fixture(scope="session")
def other_face(_cropped_faces) -> str:
    """Somebody else entirely — must never match the enrolled face."""
    return _cropped_faces[1]


@pytest.fixture(scope="session")
def group_photo() -> str:
    return encode_file(GROUP_PHOTO)


@pytest.fixture(scope="session")
def tiny_face() -> str:
    return encode_file(TINY_FACE)
