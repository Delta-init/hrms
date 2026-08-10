from typing import Any

from fastapi import HTTPException


class ServiceError(HTTPException):
    """An HTTP error carrying a stable machine-readable `code`.

    The Node backend branches on `code`, never on the message text, so messages
    can be reworded without breaking the caller.
    """

    def __init__(self, status_code: int, code: str, message: str, **extra: Any) -> None:
        super().__init__(status_code=status_code, detail={"code": code, "message": message, **extra})
        self.code = code


def bad_image(code: str, message: str, **extra: Any) -> ServiceError:
    return ServiceError(422, code, message, **extra)
