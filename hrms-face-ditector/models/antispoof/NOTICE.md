# Anti-spoofing models

These two ONNX files are the MiniFASNet presentation-attack models published by
[minivision-ai/Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing),
converted from the original PyTorch weights by `scripts/fetch_antispoof.py`.

- **Source**: minivision-ai/Silent-Face-Anti-Spoofing, `resources/anti_spoof_models/`
- **Licence**: Apache License 2.0 — full text in [LICENSE.upstream.txt](LICENSE.upstream.txt)
- **Modification**: the weights are unchanged; only the container format differs
  (`.pth` → `.onnx`), so the service can run them without PyTorch on the server.

They are committed rather than fetched at deploy time because converting them
needs PyTorch — around 2 GB of dependencies — to produce 3.3 MB of output, and
a server has no reason to carry a training framework to do that once.

## The filenames matter

`<scale>_<height>x<width>_<Arch>.onnx`

The leading number is how far beyond the detected face box the image is cropped
before the model sees it, and each model was trained at its own scale. The
service reads it from the filename, so **renaming these files silently changes
what the model is shown** and the scores stop meaning anything. Add models by
following the same convention, don't tidy the names.

## Before trusting them

The threshold that separates live from spoof depends on your camera and your
lighting, not on the model alone. Measure it where the kiosk actually stands:

```bash
uv run python scripts/calibrate_antispoof.py --live dataset/live --spoof dataset/spoof
```
