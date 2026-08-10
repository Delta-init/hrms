from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service configuration, read from the environment / .env with a FACE_ prefix."""

    model_config = SettingsConfigDict(
        env_prefix="FACE_",
        env_file=".env",
        extra="ignore",
        # Several fields start with "model_", which pydantic otherwise reserves.
        protected_namespaces=(),
    )

    host: str = "127.0.0.1"
    port: int = 8000

    # Shared secret with the Node backend. Long enough that it can't be guessed,
    # and required — a face service with no auth is worse than no face service.
    service_key: str = Field(min_length=32)

    model_pack: str = "buffalo_l"
    # InsightFace stores packs under <model_root>/models/<pack>, so "." puts
    # them in ./models/buffalo_l next to this service.
    model_root: str = "."
    det_size: int = 640
    det_thresh: float = 0.5
    ort_threads: int = 0

    # Matching. Placeholders until calibrated against real enrollment data.
    match_threshold: float = 0.45
    match_margin: float = 0.05

    enroll_min_face_pixels: int = 110
    enroll_min_det_score: float = 0.65
    enroll_min_blur: float = 45.0
    enroll_min_brightness: float = 60.0
    enroll_max_brightness: float = 215.0
    enroll_max_yaw: float = 25.0
    enroll_max_pitch: float = 25.0

    recognize_min_face_pixels: int = 80
    recognize_min_det_score: float = 0.5
    recognize_ambiguous_face_ratio: float = 0.7

    # Liveness. The kiosk sends one frame per prompt plus a spare, so the frame
    # limit has to cover a whole challenge.
    liveness_center_max_yaw: float = 14.0
    liveness_center_max_pitch: float = 22.0
    liveness_turn_min_yaw: float = 16.0
    # Frames of one challenge must all be the same person. Looser than the match
    # threshold: these are the same face seconds apart, but at different angles.
    liveness_same_person_min: float = 0.35
    # Mean absolute difference, 0-255, below which frames are the same picture.
    liveness_min_frame_difference: float = 2.0

    # Optional presentation-attack model. Unset means the pose challenge is the
    # only liveness defence — see app/antispoof.py.
    antispoof_model: str = ""
    antispoof_threshold: float = 0.5
    antispoof_input_size: int = 80
    antispoof_margin: float = 0.4
    antispoof_spoof_index: int = 0

    max_image_bytes: int = 8 * 1024 * 1024
    max_image_dim: int = 1600
    max_frames: int = 8
    max_gallery_vectors: int = 50_000

    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
