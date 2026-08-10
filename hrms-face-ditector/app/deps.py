from fastapi import Request

from .antispoof import SpoofDetector
from .engine import FaceEngine
from .gallery import GalleryStore


def get_engine(request: Request) -> FaceEngine:
    return request.app.state.engine


def get_gallery(request: Request) -> GalleryStore:
    return request.app.state.gallery


def get_spoof_detector(request: Request) -> SpoofDetector:
    return request.app.state.spoof
