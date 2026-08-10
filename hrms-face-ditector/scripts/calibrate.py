"""Pick FACE_MATCH_THRESHOLD and FACE_MATCH_MARGIN from your own faces.

The defaults shipped in .env.example are placeholders. Thresholds that are right
for one office are wrong for another — lighting, camera, and how much the staff
resemble each other all move the score distributions. Run this before rollout.

Layout:

    dataset/enrolled/<employee_id>/*.jpg   at least 2 images per person
    dataset/impostors/<anyone>/*.jpg       optional: people who are NOT enrolled

Then:

    uv run python scripts/calibrate.py --enrolled dataset/enrolled \\
        --impostors dataset/impostors

The enrolled set is scored leave-one-out: each image takes a turn as the probe
while every other image forms the gallery. That mirrors what happens at the
kiosk far better than comparing pairs of photos, because it includes the
runner-up — the colleague who scores second — which is what the margin is for.

The images are biometric data. Keep the dataset off the repo (it is gitignored),
off shared drives, and delete it when the calibration is done.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.engine import FaceEngine  # noqa: E402
from app.imaging import blur_score, crop_bbox  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def load_embeddings(root: Path, engine: FaceEngine) -> dict[str, list[np.ndarray]]:
    """Embed every image under root/<person>/, skipping unusable files."""
    import cv2

    people: dict[str, list[np.ndarray]] = defaultdict(list)
    for person_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for image_path in sorted(person_dir.iterdir()):
            if image_path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            image = cv2.imread(str(image_path))
            if image is None:
                print(f"  ! unreadable, skipped: {image_path}")
                continue
            faces = engine.detect(image)
            if not faces:
                print(f"  ! no face, skipped: {image_path}")
                continue
            if len(faces) > 1:
                print(f"  ! {len(faces)} faces, using the largest: {image_path}")
            face = faces[0]
            sharpness = blur_score(crop_bbox(image, face.bbox))
            print(f"  {image_path.name}: det={face.det_score:.2f} blur={sharpness:.0f}")
            people[person_dir.name].append(face.embedding)
    return dict(people)


def evaluate(
    enrolled: dict[str, list[np.ndarray]],
    impostors: list[np.ndarray],
    thresholds: list[float],
    margins: list[float],
) -> None:
    person_ids = list(enrolled)
    probes: list[tuple[str, int, np.ndarray]] = [
        (person, index, vector)
        for person, vectors in enrolled.items()
        for index, vector in enumerate(vectors)
    ]

    # For each probe: the best score per person, with the probe itself excluded.
    scored: list[tuple[str, dict[str, float]]] = []
    for person, index, probe in probes:
        per_person: dict[str, float] = {}
        for other, vectors in enrolled.items():
            candidates = [v for i, v in enumerate(vectors) if not (other == person and i == index)]
            if candidates:
                per_person[other] = float(max(np.dot(probe, v) for v in candidates))
        scored.append((person, per_person))

    impostor_scored = [
        {other: float(max(np.dot(probe, v) for v in vectors)) for other, vectors in enrolled.items()}
        for probe in impostors
    ]

    print()
    print(f"{len(person_ids)} people, {len(probes)} probes, {len(impostors)} impostor probes")
    print()
    print(f"{'thresh':>7} {'margin':>7} {'correct':>8} {'wrong':>7} {'rejected':>9} {'impostor':>9}")
    print("-" * 52)

    for threshold in thresholds:
        for margin in margins:
            correct = wrong = rejected = 0
            for truth, per_person in scored:
                accepted, who = _decide(per_person, threshold, margin)
                if not accepted:
                    rejected += 1
                elif who == truth:
                    correct += 1
                else:
                    wrong += 1

            impostor_accepted = sum(
                1 for per_person in impostor_scored if _decide(per_person, threshold, margin)[0]
            )
            total = max(1, len(scored))
            impostor_rate = (
                f"{100 * impostor_accepted / len(impostor_scored):7.2f}%" if impostor_scored else "      —"
            )
            print(
                f"{threshold:7.2f} {margin:7.2f} "
                f"{100 * correct / total:7.2f}% {100 * wrong / total:6.2f}% "
                f"{100 * rejected / total:8.2f}% {impostor_rate:>9}"
            )

    print()
    print("Pick the strictest row where 'wrong' and 'impostor' are 0.00% and")
    print("'rejected' is still low enough that staff aren't retrying constantly.")
    print("A wrong match marks the wrong person present; a rejection costs 5 seconds.")


def _decide(per_person: dict[str, float], threshold: float, margin: float) -> tuple[bool, str | None]:
    """Apply the same rule the service uses: top score, and beat the runner-up."""
    if not per_person:
        return False, None
    ranked = sorted(per_person.items(), key=lambda kv: kv[1], reverse=True)
    best_id, best_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if best_score < threshold or (best_score - runner_up) < margin:
        return False, None
    return True, best_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enrolled", type=Path, required=True)
    parser.add_argument("--impostors", type=Path, default=None)
    parser.add_argument("--thresholds", default="0.30,0.35,0.40,0.45,0.50,0.55,0.60")
    parser.add_argument("--margins", default="0.00,0.05,0.10")
    args = parser.parse_args()

    engine = FaceEngine(get_settings())
    engine.load()

    print(f"Embedding enrolled set: {args.enrolled}")
    enrolled = load_embeddings(args.enrolled, engine)
    if len(enrolled) < 2:
        print("Need at least 2 people to measure anything useful.", file=sys.stderr)
        return 1

    impostors: list[np.ndarray] = []
    if args.impostors and args.impostors.exists():
        print(f"Embedding impostor set: {args.impostors}")
        impostors = [v for vectors in load_embeddings(args.impostors, engine).values() for v in vectors]

    evaluate(
        enrolled,
        impostors,
        [float(t) for t in args.thresholds.split(",")],
        [float(m) for m in args.margins.split(",")],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
