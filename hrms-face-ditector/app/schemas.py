from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Several responses carry a `model_pack` field, which collides with pydantic's
# reserved "model_" namespace unless we opt out.
_ALLOW_MODEL_PREFIX = ConfigDict(protected_namespaces=())

Embedding = list[float]


# --- shared -------------------------------------------------------------------


class FaceBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class FaceQuality(BaseModel):
    """Everything we measured about the face, whether or not it passed."""

    det_score: float = Field(description="Detector confidence, 0-1")
    face_pixels: float = Field(description="Shortest side of the face box, in pixels")
    blur: float = Field(description="Variance of the Laplacian; higher is sharper")
    brightness: float = Field(description="Mean luma of the face crop, 0-255")
    yaw: float | None = None
    pitch: float | None = None
    roll: float | None = None
    passed: bool
    failures: list[str] = Field(
        default_factory=list,
        description="Machine-readable reasons, e.g. ['FACE_TOO_SMALL', 'TOO_BLURRY']",
    )


class FrameInput(BaseModel):
    """One or more base64 frames. Callers send `image` or `images`, not both."""

    image: str | None = Field(default=None, description="Base64 or data: URL")
    images: list[str] | None = Field(default=None, description="Several frames of the same person")

    @model_validator(mode="after")
    def _exactly_one_source(self):
        if bool(self.image) == bool(self.images):
            raise ValueError("Provide exactly one of `image` or `images`")
        if self.images is not None and not self.images:
            raise ValueError("`images` must not be empty")
        return self

    def frames(self) -> list[str]:
        return self.images if self.images is not None else [self.image]  # type: ignore[list-item]


# --- /v1/embed ----------------------------------------------------------------


class EmbedRequest(FrameInput):
    """Enrollment capture. Quality gates are strict here on purpose: a bad
    enrollment poisons every future match for that employee, while a bad
    recognition frame only costs one retry at the kiosk."""


class EmbedFace(BaseModel):
    embedding: Embedding
    bbox: FaceBox
    quality: FaceQuality


class EmbedResponse(BaseModel):
    model_config = _ALLOW_MODEL_PREFIX

    faces: list[EmbedFace] = Field(description="One entry per accepted frame, in input order")
    model_pack: str


# --- /v1/gallery --------------------------------------------------------------


class GalleryEntry(BaseModel):
    user_id: str = Field(min_length=1)
    embeddings: list[Embedding] = Field(min_length=1)


class GalleryReplaceRequest(BaseModel):
    version: str = Field(min_length=1, description="Opaque version string owned by the backend")
    entries: list[GalleryEntry]


class GalleryUpsertRequest(BaseModel):
    version: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    embeddings: list[Embedding] = Field(min_length=1)


class GalleryState(BaseModel):
    org_id: str
    version: str
    users: int
    vectors: int
    synced_at: float


# --- /v1/recognize ------------------------------------------------------------


class RecognizeRequest(FrameInput):
    org_id: str = Field(min_length=1)
    # Per-request overrides, for calibration runs and for orgs that need a
    # stricter bar. Omitted means "use the configured default".
    min_score: float | None = Field(default=None, ge=0.0, le=1.0)
    min_margin: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int = Field(default=3, ge=1, le=10)
    expected_version: str | None = Field(
        default=None,
        description="Fail with GALLERY_STALE if the loaded gallery is not this version",
    )


class CandidateOut(BaseModel):
    user_id: str
    score: float


RecognizeReason = Literal[
    "MATCHED",
    "NO_FACE",
    "AMBIGUOUS_FRAME",
    "LOW_QUALITY",
    "BELOW_THRESHOLD",
    "AMBIGUOUS_MATCH",
    "EMPTY_GALLERY",
]


class RecognizeResponse(BaseModel):
    matched: bool
    reason: RecognizeReason
    best: CandidateOut | None = None
    runner_up: CandidateOut | None = None
    margin: float | None = None
    candidates: list[CandidateOut] = Field(default_factory=list)
    quality: FaceQuality | None = None
    frame_index: int | None = Field(default=None, description="Which frame produced this result")
    faces_detected: int = 0
    gallery_version: str | None = None
    thresholds: dict[str, float]


# --- /health ------------------------------------------------------------------


class HealthResponse(BaseModel):
    model_config = _ALLOW_MODEL_PREFIX

    status: Literal["ok", "loading"]
    model_pack: str
    model_loaded: bool
    uptime_seconds: float
    galleries: list[GalleryState]
