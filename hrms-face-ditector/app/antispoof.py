from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .config import Settings
from .engine import DetectedFace

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpoofModel:
    session: object  # onnxruntime.InferenceSession
    input_name: str
    height: int
    width: int
    # How much of the scene around the face this model was trained to see.
    scale: float
    name: str


def _parse_model_name(name: str) -> tuple[int, int, float] | None:
    """Read `<scale>_<h>x<w>_<Arch>.onnx`, upstream's own convention.

    The scale is part of the filename because it is part of the model: each was
    trained on a particular amount of surrounding scene, and cropping tighter or
    wider than it expects quietly ruins the score rather than failing loudly.
    """
    try:
        parts = name.rsplit(".", 1)[0].split("_")
        height, width = parts[-2].split("x")
        return int(height), int(width), float(parts[0])
    except (ValueError, IndexError):
        return None


class SpoofDetector:
    """
    Presentation-attack detection: is this a live face, or a picture of one?

    Wraps the MiniFASNet models published with
    minivision-ai/Silent-Face-Anti-Spoofing (Apache-2.0), converted to ONNX by
    `scripts/fetch_antispoof.py`. No weights are committed here — point
    FACE_ANTISPOOF_DIR at the converted directory and this loads whatever it
    finds, or stays disabled and says so.

    Every model in the directory is run and their probabilities averaged, which
    is how upstream uses them. The two published models see different amounts of
    the scene, and a screen edge or the border of a printed photo often shows in
    the wider crop when the tight one looks convincing.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._models: list[SpoofModel] = []
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return bool(self._models)

    @property
    def model_names(self) -> list[str]:
        return [m.name for m in self._models]

    def load(self) -> None:
        directory = self._settings.antispoof_dir
        if not directory:
            logger.info("No anti-spoof model configured; the pose challenge is the only defence")
            return

        path = Path(directory)
        if not path.is_dir():
            logger.error("FACE_ANTISPOOF_DIR=%s is not a directory — spoof scoring is off", path)
            return

        import onnxruntime as ort

        for file in sorted(path.glob("*.onnx")):
            parsed = _parse_model_name(file.name)
            if parsed is None:
                logger.error(
                    "Ignoring %s: the filename must be <scale>_<h>x<w>_<Arch>.onnx, "
                    "because the crop scale is part of the model",
                    file.name,
                )
                continue
            height, width, scale = parsed
            session = ort.InferenceSession(str(file), providers=["CPUExecutionProvider"])
            self._models.append(
                SpoofModel(
                    session=session,
                    input_name=session.get_inputs()[0].name,
                    height=height,
                    width=width,
                    scale=scale,
                    name=file.name,
                )
            )
            logger.info("Loaded anti-spoof model %s (scale %.1f, %dx%d)", file.name, scale, height, width)

        if not self._models:
            logger.error("No usable .onnx models in %s — spoof scoring is off", path)

    def score(self, image: np.ndarray, face: DetectedFace) -> float | None:
        """Probability that this face is a presentation attack, or None if off."""
        if not self._models:
            return None

        probabilities = np.zeros(3, dtype=np.float64)
        for model in self._models:
            patch = self._crop(image, face, model)
            if patch is None:
                return None
            # ToTensor() and nothing else, which is all upstream applies: HWC to
            # CHW, scaled to 0-1, and left in BGR — the channel order OpenCV
            # read it in and therefore the order these were trained on.
            blob = patch.astype(np.float32) / 255.0
            blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

            with self._lock:
                logits = model.session.run(None, {model.input_name: blob})[0]
            probabilities += _softmax(np.asarray(logits, dtype=np.float64).reshape(-1))

        probabilities /= len(self._models)
        live = float(probabilities[self._settings.antispoof_live_index])
        return 1.0 - live

    def _crop(self, image: np.ndarray, face: DetectedFace, model: SpoofModel) -> np.ndarray | None:
        """Upstream's crop, reproduced exactly.

        The box is grown by the model's scale about its centre, then shifted
        back inside the frame rather than clipped, so the face keeps its size
        when somebody stands near the edge of the shot.
        """
        source_h, source_w = image.shape[:2]
        x1, y1, x2, y2 = face.bbox
        box_w, box_h = x2 - x1, y2 - y1
        if box_w <= 0 or box_h <= 0:
            return None

        scale = min((source_h - 1) / box_h, min((source_w - 1) / box_w, model.scale))
        new_w, new_h = box_w * scale, box_h * scale
        centre_x, centre_y = x1 + box_w / 2, y1 + box_h / 2

        left = centre_x - new_w / 2
        top = centre_y - new_h / 2
        right = centre_x + new_w / 2
        bottom = centre_y + new_h / 2

        if left < 0:
            right -= left
            left = 0
        if top < 0:
            bottom -= top
            top = 0
        if right > source_w - 1:
            left -= right - (source_w - 1)
            right = source_w - 1
        if bottom > source_h - 1:
            top -= bottom - (source_h - 1)
            bottom = source_h - 1

        patch = image[int(top) : int(bottom) + 1, int(left) : int(right) + 1]
        if patch.size == 0:
            return None
        return cv2.resize(patch, (model.width, model.height))


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = np.exp(values - values.max())
    return shifted / shifted.sum()
