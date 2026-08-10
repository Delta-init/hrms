from __future__ import annotations

import base64
import binascii
import re

import cv2
import numpy as np

from .errors import bad_image

_DATA_URL = re.compile(r"^data:image/[a-zA-Z0-9.+-]+;base64,", re.IGNORECASE)


def decode_image(payload: str, *, max_bytes: int, max_dim: int) -> np.ndarray:
    """Decode a base64 image (raw or `data:` URL) into a BGR ndarray.

    Oversized images are scaled down rather than rejected: a kiosk tablet may
    hand us a 12 MP still, and the detector runs at 640px anyway, so the extra
    pixels only cost time.
    """
    raw = _DATA_URL.sub("", payload.strip())
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise bad_image("INVALID_BASE64", "Image is not valid base64") from exc

    if not data:
        raise bad_image("EMPTY_IMAGE", "Image payload is empty")
    if len(data) > max_bytes:
        raise bad_image(
            "IMAGE_TOO_LARGE",
            f"Image is {len(data)} bytes, limit is {max_bytes}",
            bytes=len(data),
            limit=max_bytes,
        )

    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise bad_image("UNDECODABLE_IMAGE", "Image could not be decoded (unsupported or corrupt)")

    longest = max(image.shape[0], image.shape[1])
    if longest > max_dim:
        scale = max_dim / longest
        image = cv2.resize(
            image,
            (round(image.shape[1] * scale), round(image.shape[0] * scale)),
            interpolation=cv2.INTER_AREA,
        )
    return image


def crop_bbox(image: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray:
    """Clamp a detector bbox to the image and return that crop (may be empty)."""
    height, width = image.shape[:2]
    x1 = max(0, min(width - 1, int(bbox[0])))
    y1 = max(0, min(height - 1, int(bbox[1])))
    x2 = max(x1 + 1, min(width, int(bbox[2])))
    y2 = max(y1 + 1, min(height, int(bbox[3])))
    return image[y1:y2, x1:x2]


def blur_score(face_crop: np.ndarray) -> float:
    """Variance of the Laplacian — low means soft focus or motion blur."""
    if face_crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def brightness(face_crop: np.ndarray) -> float:
    """Mean luma of the face crop, 0-255. Catches backlit and blown-out frames."""
    if face_crop.size == 0:
        return 0.0
    return float(cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY).mean())
