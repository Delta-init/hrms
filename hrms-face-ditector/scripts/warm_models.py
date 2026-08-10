"""Download and initialise the model pack ahead of first boot.

Run this during deploy. Without it the first request after a fresh install
waits on a ~300 MB download, and pm2 will have already restarted the process a
few times thinking it hung.

    uv run python scripts/warm_models.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.engine import FaceEngine  # noqa: E402


def main() -> int:
    settings = get_settings()
    print(f"Loading model pack '{settings.model_pack}' into {settings.model_root}/models ...")
    started = time.monotonic()

    engine = FaceEngine(settings)
    engine.load()

    # One inference pass so ORT allocates its arenas now rather than on the
    # first real punch. A blank frame finds no face, which is fine — we only
    # care that the graph ran.
    blank = np.zeros((settings.det_size, settings.det_size, 3), dtype=np.uint8)
    engine.detect(blank)

    print(f"Ready in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
