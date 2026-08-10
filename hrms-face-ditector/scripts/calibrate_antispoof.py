"""Measure the anti-spoof model against your own camera, and pick a threshold.

The shipped threshold is a guess. Spoof scores move with your camera, your
lighting, and what the attack actually is — a matte print behaves nothing like
a bright phone screen — so a number that works in one lobby is wrong in the
next.

Collect two folders with the kiosk camera, the kiosk lighting, and the people
who will actually use it:

    dataset/live/*.jpg    real people sitting in front of the camera
    dataset/spoof/*.jpg   the camera looking at a photo of those people:
                          printed, and on a phone screen, at a few angles
                          and distances

Then:

    uv run python scripts/calibrate_antispoof.py --live dataset/live --spoof dataset/spoof

It prints, for each threshold, how many live people would be turned away and
how many spoofs would get through. Choose from that table. Letting a spoof
through is somebody clocking in a colleague who is not there; turning a live
person away costs them a retry.

These are photographs of staff. The dataset is gitignored — delete it when the
calibration is done.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.antispoof import SpoofDetector  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.engine import FaceEngine  # noqa: E402

SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def score_folder(folder: Path, engine: FaceEngine, detector: SpoofDetector) -> list[float]:
    scores: list[float] = []
    for path in sorted(p for p in folder.iterdir() if p.suffix.lower() in SUFFIXES):
        image = cv2.imread(str(path))
        if image is None:
            print(f"  ! unreadable: {path.name}")
            continue
        faces = engine.detect(image)
        if not faces:
            print(f"  ! no face: {path.name}")
            continue
        score = detector.score(image, faces[0])
        if score is None:
            print(f"  ! not scored: {path.name}")
            continue
        scores.append(score)
        print(f"  {path.name}: spoof={score:.3f}")
    return scores


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", type=Path, required=True)
    parser.add_argument("--spoof", type=Path, required=True)
    parser.add_argument("--thresholds", default="0.3,0.4,0.5,0.6,0.7,0.8,0.9")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.antispoof_dir:
        print("FACE_ANTISPOOF_DIR is not set — run scripts/fetch_antispoof.py first.", file=sys.stderr)
        return 1

    engine = FaceEngine(settings)
    engine.load()
    detector = SpoofDetector(settings)
    detector.load()
    if not detector.available:
        print("No anti-spoof models loaded; nothing to calibrate.", file=sys.stderr)
        return 1
    print(f"Models: {', '.join(detector.model_names)}\n")

    print(f"Live samples ({args.live}):")
    live = score_folder(args.live, engine, detector)
    print(f"\nSpoof samples ({args.spoof}):")
    spoof = score_folder(args.spoof, engine, detector)

    if not live or not spoof:
        print("\nNeed at least one scored image in each folder.", file=sys.stderr)
        return 1

    live.sort()
    spoof.sort()
    print(
        f"\n{len(live)} live (spoof score {live[0]:.3f}–{live[-1]:.3f}), "
        f"{len(spoof)} spoof ({spoof[0]:.3f}–{spoof[-1]:.3f})"
    )
    if live[-1] < spoof[0]:
        print(f"Cleanly separated. Anything between {live[-1]:.3f} and {spoof[0]:.3f} works.")
    else:
        print("The ranges overlap — no threshold separates them perfectly. Pick from the table.")

    print(f"\n{'threshold':>10} {'live turned away':>18} {'spoofs let through':>20}")
    print("-" * 50)
    for raw in args.thresholds.split(","):
        threshold = float(raw)
        rejected = sum(1 for s in live if s >= threshold)
        passed = sum(1 for s in spoof if s < threshold)
        print(
            f"{threshold:10.2f} {100 * rejected / len(live):17.1f}% {100 * passed / len(spoof):19.1f}%"
        )

    print(
        "\nPick the highest threshold that still lets no spoof through, then set\n"
        "FACE_ANTISPOOF_THRESHOLD to it. Re-measure if you change camera or lighting."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
