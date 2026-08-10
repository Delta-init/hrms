# HRMS Face Detector

Face enrollment and 1:N recognition for kiosk attendance. Phase 1 of the
biometric check-in work: this service turns a photo into an identity guess and
a confidence score. It does not touch MongoDB, and it never records attendance.

```
Kiosk tablet ──frame──▶ hrms-backend ──frame──▶ hrms-face-ditector
                             │                        │
                             │◀─── user_id + score ───┘
                             ▼
                  attendanceService.clockIn/clockOut
```

**The frame is matched here, on the server, not in the browser.** If the tablet
computed the embedding, anyone with devtools could post a colleague's vector and
punch in as them. Face attendance is only worth having if the client is treated
as untrusted, so the raw image crosses to a process the employee cannot reach.

## Requirements

- Python 3.10–3.12 (ONNX Runtime has no 3.13+ wheels yet)
- ~1.5 GB RAM for the loaded model pack, ~350 MB disk for the models
- CPU only — no GPU needed at kiosk volumes

## Install

```bash
cd hrms-face-ditector
uv venv --python 3.11
uv pip install -e .
cp .env.example .env      # then set FACE_SERVICE_KEY
uv run python scripts/warm_models.py
```

On the VPS, if the `insightface` wheel has to build from source:

```bash
apt-get install -y build-essential cmake python3-dev
```

`warm_models.py` downloads the ~300 MB `buffalo_l` pack into `./models`. Run it
during deploy — without it the first request after a fresh install stalls on the
download, and pm2 restarts the process thinking it hung.

## Run

```bash
.venv/bin/python -m app.main
```

Under pm2, alongside `hrms-api`:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

**One process only.** The enrolled-face gallery lives in this process's memory,
so a second worker would answer recognitions against an empty cache. The pm2
config pins `instances: 1`; don't add `--workers` to uvicorn.

Bind to `127.0.0.1` and leave it off the public internet. The service key is the
second lock, not the only one.

## Configuration

Everything is env-driven with a `FACE_` prefix — see [.env.example](.env.example)
for the full list. The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `FACE_SERVICE_KEY` | — | Required, ≥32 chars. `openssl rand -hex 32` |
| `FACE_MATCH_THRESHOLD` | `0.45` | **Placeholder — calibrate before rollout** |
| `FACE_MATCH_MARGIN` | `0.05` | How far the top match must beat the runner-up |
| `FACE_ENROLL_*` | see file | Strict gates: a bad enrollment is permanent |
| `FACE_RECOGNIZE_*` | see file | Loose gates: a bad frame just costs a retry |

## API

All endpoints except `/health` require `X-Face-Service-Key`. Errors return a
flat `{"code", "message", ...}` body — branch on `code`, never on the message.

### `GET /health`

Unauthenticated. Returns model state and every gallery this process holds.
**An empty `galleries` list means the process restarted and lost its cache** —
that is the backend's signal to re-push embeddings.

### `POST /v1/embed`

Enrollment. Takes `{"image": "<base64>"}` or `{"images": [...]}`, returns a
512-d unit-length embedding per frame plus the measured quality.

Fails with `NO_FACE`, `MULTIPLE_FACES`, or `LOW_QUALITY` (with a `failures` list
like `["TOO_BLURRY", "HEAD_TURNED"]`) so the admin UI can say what to redo. One
bad frame fails the whole request: an enrollment quietly short a good angle is
exactly what produces mystery mismatches months later.

### `PUT /v1/gallery/{org_id}`

Full sync: `{"version": "<opaque>", "entries": [{"user_id", "embeddings": [[...]]}]}`.
The `version` is owned by the backend — a hash or a counter over enrolled
profiles. Call this at backend startup, after bulk enrollment changes, and
whenever `/health` shows the gallery is gone.

- `POST /v1/gallery/{org_id}/entries` — upsert one employee
- `DELETE /v1/gallery/{org_id}/entries/{user_id}?version=…` — offboarding, or a
  withdrawal of biometric consent
- `GET /v1/gallery/{org_id}` — current version and counts

### `POST /v1/recognize`

```json
{ "org_id": "…", "image": "<base64>", "expected_version": "v12" }
```

Returns 200 with `matched`, `reason`, `best`, `runner_up`, `margin`, and the
`thresholds` actually applied. A match requires **both** `score ≥ min_score`
**and** `margin ≥ min_margin`.

An unreadable frame is not an error — it is someone standing slightly wrong — so
`NO_FACE`, `LOW_QUALITY`, `AMBIGUOUS_FRAME`, `BELOW_THRESHOLD` and
`AMBIGUOUS_MATCH` all come back 200 with `matched: false` and a reason the kiosk
can turn into "step closer". Only real caller faults raise: `409
GALLERY_NOT_LOADED`, `409 GALLERY_STALE`, `422` for a malformed payload.

`AMBIGUOUS_FRAME` means two faces of similar size were in shot and we cannot
tell who is punching in. `AMBIGUOUS_MATCH` means two employees scored within
`margin` of each other. Both refuse rather than guess — the PIN fallback exists
for these.

Send several frames as `images` and the best-scoring one wins, which is what the
liveness challenge in Phase 4 will use.

## Calibration

**Do this before rollout.** The shipped threshold is a placeholder; the right
value depends on your lighting, your camera, and how much your staff resemble
each other.

```bash
# dataset/enrolled/<employee_id>/*.jpg   (2+ images each)
# dataset/impostors/<anyone>/*.jpg       (people who are NOT enrolled)
uv run python scripts/calibrate.py --enrolled dataset/enrolled --impostors dataset/impostors
```

It runs the same decision rule the service uses, leave-one-out, and prints a
threshold × margin grid with correct / wrong / rejected / impostor-accepted
rates. Pick the strictest row where wrong and impostor are both 0.00% and
rejections are still low enough that staff aren't retrying constantly — a wrong
match marks the wrong person present, a rejection costs five seconds.

The dataset is biometric data. It is gitignored; delete it when you are done.

## Performance

Measured on an M-series laptop, `det_size=640`, CPU only:

| Operation | Time |
| --- | --- |
| Single-face 1280×720 frame (detect + embed) | ~220 ms |
| Six-face group photo | ~1.0 s |
| 1:N search, 2,000 employees × 5 captures | ~2.4 ms |
| Model load at startup | ~11 s |

A VPS core will be slower — budget 0.4–1 s per punch and measure on the box.
Search cost is irrelevant next to inference, which is why the gallery is a plain
numpy matrix and not a vector database.

## Tests

```bash
.venv/bin/python -m pytest tests -q
```

22 tests over the real HTTP surface, using the sample photos bundled with
insightface — no employee data required. They relax the enrollment gates for the
run, because those samples are ~110 px faces at awkward angles; production keeps
the strict defaults.

## Not in this phase

- **Liveness / anti-spoofing.** A printed photo or a phone screen will match
  today. Phase 4 adds a passive spoof model plus a randomised blink/turn
  challenge. Do not run unsupervised kiosks before then.
- Attendance decisions, device tokens, audit images — all backend-side, Phase 3.
- Auto-deploy. The backend workflow only fires on `hrms-backend/**`; a matching
  `deploy-face.yml` is a deliberate next step, not an accident.
