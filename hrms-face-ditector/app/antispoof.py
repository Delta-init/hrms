from __future__ import annotations

import logging
import os
import threading

import cv2
import numpy as np

from .config import Settings
from .engine import DetectedFace

logger = logging.getLogger(__name__)


class SpoofDetector:
    """
    Optional presentation-attack model, loaded from an ONNX file if one is set.

    Nothing ships with weights. The pose challenge in `liveness.py` is what
    defends this system out of the box, and it already defeats a printed photo
    or a still on a screen. What it cannot do is tell a live face from a video
    of the right person performing the right sequence — that needs a model
    trained on presentation attacks, and those weights have their own licence
    and have to be chosen deliberately rather than pulled in by a library.

    So this is a slot, not an implementation. Point FACE_ANTISPOOF_MODEL at an
    ONNX classifier that takes an aligned face crop and returns a spoof
    probability, set FACE_ANTISPOOF_THRESHOLD from your own measurements, and
    the punch flow starts consulting it. Leave it unset and `available` is
    False, which the API reports honestly rather than implying a protection
    that isn't there.

    UNTESTED PATH: with no weights available here, the scoring branch below has
    never run. Validate it against known-live and known-spoof samples before
    relying on it.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._session = None
        self._input_name: str | None = None
        self._size = settings.antispoof_input_size
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self._session is not None

    def load(self) -> None:
        path = self._settings.antispoof_model
        if not path:
            logger.info("No anti-spoof model configured; relying on the pose challenge alone")
            return
        if not os.path.exists(path):
            logger.error("FACE_ANTISPOOF_MODEL is set to %s, which does not exist — spoof scoring is off", path)
            return

        import onnxruntime as ort

        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name
        logger.info("Loaded anti-spoof model from %s", path)

    def score(self, image: np.ndarray, face: DetectedFace) -> float | None:
        """Spoof probability for one face, or None when no model is loaded."""
        if self._session is None:
            return None

        crop = self._crop(image, face)
        if crop is None:
            return None

        blob = cv2.resize(crop, (self._size, self._size), interpolation=cv2.INTER_AREA)
        blob = cv2.cvtColor(blob, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

        with self._lock:
            outputs = self._session.run(None, {self._input_name: blob})

        scores = np.asarray(outputs[0]).reshape(-1)
        if scores.size == 1:
            return float(scores[0])
        # Two-class output: take the spoof class, after a softmax if the model
        # emits logits rather than probabilities.
        if not np.isclose(scores.sum(), 1.0, atol=1e-3):
            exp = np.exp(scores - scores.max())
            scores = exp / exp.sum()
        return float(scores[self._settings.antispoof_spoof_index])

    def _crop(self, image: np.ndarray, face: DetectedFace) -> np.ndarray | None:
        """Face box with margin — spoof cues live in the border, not the face."""
        margin = self._settings.antispoof_margin
        x1, y1, x2, y2 = face.bbox
        pad_x, pad_y = (x2 - x1) * margin, (y2 - y1) * margin
        height, width = image.shape[:2]
        left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
        right, bottom = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
        if right <= left or bottom <= top:
            return None
        return image[top:bottom, left:right]
