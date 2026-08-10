"""Fetch the MiniFASNet anti-spoofing weights and convert them to ONNX.

Run once, by a developer, on a machine with PyTorch. The service itself only
ever loads the resulting .onnx files and never needs torch:

    uv pip install "torch>=2.2"
    uv run python scripts/fetch_antispoof.py

Weights and architecture come from minivision-ai/Silent-Face-Anti-Spoofing
(Apache-2.0), the reference implementation these models were published with.
Nothing is vendored into this repo: the sources are downloaded to a temporary
directory, converted, and discarded, so the only artefact is the ONNX file.

Two models are converted, not one. Upstream runs both and sums their outputs —
each sees a different amount of the surrounding scene (2.7x and 4.0x the face
box), and a screen bezel or the edge of a printed photo often shows up in the
wider crop when the tight one looks convincing.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = "minivision-ai/Silent-Face-Anti-Spoofing"
RAW = f"https://raw.githubusercontent.com/{REPO}/master"

# Filenames carry their own contract upstream: "<scale>_<h>x<w>_<Arch>".
MODELS = ["2.7_80x80_MiniFASNetV2.pth", "4_0_0_80x80_MiniFASNetV1SE.pth"]

# Only what the architecture needs to import.
SOURCES = [
    "src/model_lib/MiniFASNet.py",
    "src/model_lib/MultiFTNet.py",
    "src/utility.py",
]

OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "antispoof"


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"  {url.rsplit('/', 1)[-1]}")
    with urllib.request.urlopen(url) as response, open(target, "wb") as out:
        shutil.copyfileobj(response, out)


def parse_model_name(name: str) -> tuple[int, int, str, float]:
    """Upstream's convention, reproduced so the scale stays tied to the file."""
    info = name.split("_")[0:-1]
    height, width = info[-1].split("x")
    architecture = name.split(".pth")[0].split("_")[-1]
    return int(height), int(width), architecture, float(info[0])


def main() -> int:
    try:
        import torch
    except ImportError:
        print(
            "PyTorch is needed for the conversion only:\n"
            '    uv pip install "torch>=2.2"',
            file=sys.stderr,
        )
        return 1

    work = Path(tempfile.mkdtemp(prefix="antispoof-"))
    try:
        print(f"Fetching architecture from {REPO} …")
        (work / "src" / "model_lib").mkdir(parents=True)
        (work / "src" / "__init__.py").touch()
        (work / "src" / "model_lib" / "__init__.py").touch()
        for source in SOURCES:
            download(f"{RAW}/{source}", work / source)

        sys.path.insert(0, str(work))
        from src.model_lib.MiniFASNet import (  # noqa: E402
            MiniFASNetV1, MiniFASNetV1SE, MiniFASNetV2, MiniFASNetV2SE,
        )

        mapping = {
            "MiniFASNetV1": MiniFASNetV1,
            "MiniFASNetV2": MiniFASNetV2,
            "MiniFASNetV1SE": MiniFASNetV1SE,
            "MiniFASNetV2SE": MiniFASNetV2SE,
        }

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        print("\nFetching weights …")
        for name in MODELS:
            weights = work / name
            download(f"{RAW}/resources/anti_spoof_models/{name}", weights)

            height, width, architecture, _scale = parse_model_name(name)
            kernel = ((height + 15) // 16, (width + 15) // 16)
            model = mapping[architecture](conv6_kernel=kernel)

            state = torch.load(weights, map_location="cpu", weights_only=True)
            # Weights were saved from a DataParallel wrapper, so every key is
            # prefixed with "module.".
            if next(iter(state)).startswith("module."):
                state = {key[7:]: value for key, value in state.items()}
            model.load_state_dict(state)
            model.eval()

            target = OUT_DIR / name.replace(".pth", ".onnx")
            torch.onnx.export(
                model,
                torch.randn(1, 3, height, width),
                str(target),
                input_names=["input"],
                output_names=["logits"],
                dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
                opset_version=11,
                # The newer exporter writes weights to a sibling .data file.
                # These models are under 2 MB, and one self-contained file per
                # model is far easier to ship to a server than a pair that must
                # travel together.
                dynamo=False,
            )
            print(f"    → {target.relative_to(OUT_DIR.parents[1])}")

        print(
            f"\nDone. Point the service at them:\n"
            f"    FACE_ANTISPOOF_DIR={OUT_DIR.relative_to(OUT_DIR.parents[1])}\n\n"
            "Then calibrate before trusting it:\n"
            "    uv run python scripts/calibrate_antispoof.py "
            "--live dataset/live --spoof dataset/spoof"
        )
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
