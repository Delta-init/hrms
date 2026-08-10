import secrets

from fastapi import Header

from .config import get_settings
from .errors import ServiceError


async def require_service_key(x_face_service_key: str = Header(default="")) -> None:
    """Guard every endpoint except /health.

    Constant-time comparison so the key can't be recovered by timing repeated
    requests. The service should also be bound to loopback — this header is the
    second lock, not the only one.
    """
    expected = get_settings().service_key
    if not secrets.compare_digest(x_face_service_key, expected):
        raise ServiceError(401, "UNAUTHORIZED", "Missing or invalid X-Face-Service-Key")
