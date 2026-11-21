# Arena Pressure video capture (Phase 1)

## Investigation record

The public route `/{culture}/tv/pressure/{matchId}/{slug}` is hosted by
`ArenaPressureGamePage.razor`. It loads the authoritative match through
`CriptoVersusApiClient` and passes it to `ArenaPressureGameHost.razor`. The host loads
real score events and metric snapshots, then `ArenaPressureSource.BuildHistory`
reconstructs the pressure timeline with the same possession composition used by the
Match Arena. No simulated preview data participates in capture.

The host creates the Phaser renderer in `wwwroot/js/arena-pressure/engine.ts`. Its one
animation frame updates the replay sample, wheel, characters, pressure art, logos,
ropes, HUD, and particles in order. The public replay maps long match histories to a
watchable 15–120 second window and offers play, seek, and 0.5×–4× controls. Capture
does not change that public behavior: it supplies the uncompressed historical span,
starts paused at zero, and fixes the engine clock at 4×.

The first frame is the history sample at `t=0`. The last frame is reached only when
the engine playhead equals the final history timestamp. The capture contract then
holds that official final visual for two seconds before reporting `completed`.

`/dev/match-preview` uses a deterministic in-memory source and is useful as an
example of Development isolation and clock control. It is deliberately not a data
source for video capture.

Main synchronization risks are asynchronous API/asset loading, a browser recorder
starting before the replay, and closing before Phaser paints the final state. The
restricted `window.__arenaPressureCapture` contract reports `ready`, starts the
already-loaded engine on command, exposes logical position/duration/speed, and reports
`completed` only after the final-frame hold. The tool does not use fixed startup
delays or simulated button clicks.

## Local execution

Prerequisites:

- CriptoVersus.Web running in the `Development` environment and connected to its API.
- The repository's npm dependencies installed (`npm ci --prefix CriptoVersus`).
- The Playwright Chromium browser installed for the pinned package.
- `ffmpeg` and `ffprobe` available on `PATH`, or passed with `--ffmpeg` and
  `--ffprobe`. No global installation is performed by the tool.

From `CriptoVersus`:

```powershell
npm run capture:arena-pressure -- --match-id 12345 --base-url http://localhost:5287
```

The tool opens the real replay with `?mode=videoCapture&speed=4`, records a 1920×1080
browser viewport, trims pre-roll, and asks FFmpeg to produce H.264 at 30 FPS,
`yuv420p`, with `faststart`. It validates the container, codec, dimensions, frame
rate, duration, decode integrity, and nonblank first/last frames.

Outputs and timestamped diagnostic logs are written to
`.codex-artifacts-local/arena-pressure/`, which is ignored by Git. A per-match lock
prevents conflicting concurrent runs; temporary browser recordings are removed on
success or failure.

The capture query is available automatically only in Development. Outside
Development it stays disabled by default and returns HTTP 404 unless the dedicated
capture configuration and request header described below are both valid. It is not
exposed in the public UI and has no publishing, Binance Square, n8n, authentication,
Worker, SignalR, or financial side effects.

## Browserless 10-second preview (Phase 2)

The independent Browserless v1 client is
`CriptoVersus/tools/arena-pressure/capture-browserless.mjs`. It calls the existing
`POST /screencast` endpoint, waits for the real Phaser replay contract to reach
`ready`, starts Browserless recording before calling `start()`, and records exactly
ten wall-clock seconds at logical speed 4×. The prototype is hard-limited to match
46156, 1280×720, ten seconds, and 4×; other values are rejected.

Outside Development, the Web capture surface remains disabled by default. Enabling
it requires both `ArenaPressureCapture:Enabled=true` and a nonempty
`ArenaPressureCapture:AccessKey`. Requests must provide the value in the
`X-Arena-Capture-Key` header. Missing, disabled, and incorrect configurations all
return 404. The key is never accepted in the replay URL.

Required environment-variable names for the client:

- `ARENA_PRESSURE_BROWSERLESS_URL`: authenticated Browserless base URL. Its query is
  preserved, but it is never printed in logs.
- `ARENA_PRESSURE_CAPTURE_BASE_URL`: the one allowed CriptoVersus origin.
- `ARENA_PRESSURE_CAPTURE_KEY`: value matching the Web capture access key.
- Optional `FFMPEG_PATH` and `FFPROBE_PATH`.

Example (values are intentionally omitted):

```powershell
npm run capture:arena-pressure:browserless -- --match-id 46156 --duration 10 --speed 4 --width 1280 --height 720
```

The response is streamed to disk with a 100 MiB ceiling. The tool keeps the VP8 WebM,
converts it to H.264/MP4 at 30 FPS with `yuv420p` and `faststart`, and emits a JSON
report with frame timestamps, effective capture FPS, maximum frame gap, long-gap
counts, sizes, elapsed times, and client RSS. Output names are:

```text
arena-pressure-match-46156-preview.webm
arena-pressure-match-46156-preview.mp4
arena-pressure-match-46156-preview.json
arena-pressure-match-46156-preview.log
```

Browserless v1 returns only the WebM body from `/screencast`; it does not return the
function's JavaScript result. The in-browser function therefore rejects the request
unless the playhead starts at zero and advances within tolerance of 40 logical
seconds (or reaches the end). The technical JSON records that validation but leaves
the exact end playhead null rather than inventing a value.

## Future n8n phase (not implemented)

A future authenticated internal job endpoint can enqueue a match ID for a dedicated
capture worker. That worker can invoke this same command in an isolated Linux image,
store the validated MP4 in managed object storage, and return an artifact reference
to n8n. Only after successful validation should a separate publishing workflow send
that reference to Binance. Queue idempotency, service authentication, retention, and
publication audit records belong to that later phase.
