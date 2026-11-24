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
ten wall-clock seconds at logical speed 4×. It accepts any positive integer
`--match-id` and enforces the fixed 1280×720, ten-second, 4× preview profile.

Outside Development, the Web capture surface remains disabled by default. Enabling
it requires both `ArenaPressureCapture:Enabled=true` and a nonempty
`ArenaPressureCapture:AccessKey`. Requests must provide the value in the
`X-Arena-Capture-Key` header. Missing, disabled, and incorrect configurations all
return 404. The key is never accepted in the replay URL.

Required environment-variable names for the client:

- `ARENA_PRESSURE_BROWSERLESS_URL`: authenticated Browserless base URL. Its query and
  credentials are never printed in logs.
- `ARENA_PRESSURE_CAPTURE_BASE_URL`: the one allowed CriptoVersus origin (HTTPS).
- `ARENA_PRESSURE_CAPTURE_KEY`: value matching the Web capture access key.
- Optional `FFMPEG_PATH` and `FFPROBE_PATH`.

Example (values are intentionally omitted):

```powershell
npm run capture:arena-pressure:browserless -- --match-id 12345 --duration 10 --speed 4 --width 1280 --height 720
```

The response is streamed to disk with a 100 MiB ceiling and handed to the shared
media pipeline in `CriptoVersus/tools/arena-pressure/capture-media.mjs`
(`processWebmToMp4`), which is compatible with Node.js 18.19.0+ (zero `node_modules`)
and both FFmpeg/FFprobe 4.4.2 and 8.x:

1. **WebM probing & validation**: runs `ffprobe` in a single pass with `-count_frames`
   and parses both `packets_and_frames` and separate `frames`/`packets` payloads,
   handling FFmpeg 4.x (`pkt_pts_time`, `pkt_duration_time`) and 7/8+ (`pts_time`,
   `duration_time`) field names. Validates WebM container, VP8 or VP9 video codec,
   exact dimensions, at least one real decoded video frame, positive duration
   (resolved from `format`, `frame_timestamps`, or `packet_timestamps`) within
   tolerance, and a full-stream decode check (`ffmpeg -v error -xerror ... -f null -`
   rejecting non-zero exit codes or non-empty stderr).
2. **WebM preservation**: once validated, the WebM is published atomically without
   overwriting existing files. If WebM validation or decode fails, the exact received
   bytes are preserved as `<prefix>.failed.webm`.
3. **MP4 transcoding & validation**: converts the WebM using
   `-fflags +genpts -map 0:v:0 -vf scale=1280:720:flags=lanczos,setsar=1,fps=30 -c:v libx264 -preset veryfast -threads 2 -crf 23 -pix_fmt yuv420p -an -movflags +faststart -f mp4`
   (tuned for 4 GB RAM VPS hosts), verifies full MP4 decode, validates container,
   H.264 codec, resolution, `30/1` frame rate, `yuv420p`, decoded frame count,
   duration, and nonblank first/last frame luma (`YAVG >= 2`), and publishes the MP4
   without overwriting existing files.

Output names are timestamped per run (`<runId>` in UTC):

```text
arena-pressure-match-<matchId>-preview-<runId>.webm
arena-pressure-match-<matchId>-preview-<runId>.mp4
arena-pressure-match-<matchId>-preview-<runId>.json
arena-pressure-match-<matchId>-preview-<runId>.log
```

### Pipeline observability markers

Both `capture-browserless.mjs` and `reprocess-webm.mjs` emit structured, secret-free
stage markers from the shared pipeline:

- `[VIDEO:RECEIVED] bytes=<size>`
- `[VIDEO:PROBE] codec=<codec> width=<width> height=<height>`
- `[VIDEO:FRAMES] count=<count>`
- `[VIDEO:DURATION] method=<format|frame_timestamps|packet_timestamps|unavailable> seconds=<seconds>`
- `[VIDEO:VALIDATED]`
- `[PERF:WEBM] frames=<count> durationSeconds=<d> effectiveFps=<efps> averageFps=<afps> avgGapMs=<ms> p50GapMs=<ms> p95GapMs=<ms> maxGapMs=<ms> over50ms=<n> over100ms=<n> over200ms=<n> windowFpsMin=<n> windowFpsMax=<n>`
- `[VIDEO:TRANSCODE_START]`
- `[VIDEO:TRANSCODE_COMPLETE]`
- `[VIDEO:MP4_VALIDATED]`
- `[VIDEO:FAILED] stage=<stage> reason=<reason> exitCode=<code-or-na>`

Additionally, during Browserless captures (`browserless-capture-function.mjs` +
`engine.ts`), the Browserless process stdout emits secret-free performance diagnostics:

- `[PERF:PHASER] renderer=... updateFps=... renderFps=... avgFrameMs=... p95FrameMs=... avgRenderMs=... avgWheelMs=... avgGapMs=... p95GapMs=... maxGapMs=... overBudgetFrames=... longTasks=... webglContextLost=...`
- `[PERF:BROWSERLESS] wallElapsedMs=... screencastMode=browserless_v1_rest frameEvents=unavailable_in_v1_response`

In `videoCapture` mode, `engine.ts` uses `Phaser.CANVAS` by default (avoiding
CPU SwiftShader WebGL overhead in headless containers without GPU), scales the
internal wheel canvas (`0.5`), skips redundant wheel/HUD/badge redraws when visual
inputs are unchanged, and `ArenaPressureGameHost.razor` skips the hidden UI clock
and transport polling loops. Public interactive rendering remains `Phaser.AUTO`.

### Controlled FPS diagnostics (`diagnose-browserless-fps.mjs`)

Use `diagnose-browserless-fps.mjs` (zero `node_modules`) to separate Browserless
`/screencast` capture ceilings from Phaser scene cost:

1. **Offline WebM cadence analysis** (inspects any existing `.webm`/`.failed.webm`
   timestamps, percentiles, gap thresholds, and 1-second FPS windows):

```powershell
npm run diagnose:arena-pressure:fps -- --analyze-webm /path/to/capture.webm
```

2. **Synthetic Canvas2D Browserless benchmark** (streams a self-contained 60 FPS
   Canvas2D page via `page.setContent` with zero backend requests, e.g. at `1280x720`
   and `640x360`, preserving outputs without overwriting existing files):

```powershell
npm run diagnose:arena-pressure:fps -- --synthetic --width 1280 --height 720 --duration 10 --output /tmp/arena-pressure-phase2/out
```

### Reprocessing preserved `.failed.webm` files

`CriptoVersus/tools/arena-pressure/reprocess-webm.mjs` runs the exact same
`processWebmToMp4` validation and transcoding pipeline on an existing `.webm` or
`.failed.webm` file without launching a browser or requiring capture secrets. It
never modifies or deletes the input file and never overwrites an existing output MP4.

From `CriptoVersus`:

```powershell
npm run reprocess:arena-pressure:webm -- --input /path/to/capture.failed.webm
```

Optional flags: `--output <mp4-path>` (defaults to replacing `.failed.webm` or
`.webm` with `.mp4` in the same directory), `--duration <seconds|auto>` (default
`10`), `--tolerance <seconds>` (default `2`), `--width 1280`, `--height 720`,
`--fps 30`, `--threads 2`. Respects `FFMPEG_PATH` and `FFPROBE_PATH`. Exit codes:
`0` on success, `1` on validation/transcode failure, `2` on CLI usage error.

### VPS hot-update without restarting Browserless

The Phase 2 client and reprocessing CLI have zero `node_modules` dependencies and
run on Node.js 18.19.0+ with FFmpeg/FFprobe 4.4.2+. Standalone runtime files:

1. `CriptoVersus/tools/arena-pressure/capture-media.mjs`
2. `CriptoVersus/tools/arena-pressure/capture-browserless.mjs`
3. `CriptoVersus/tools/arena-pressure/reprocess-webm.mjs`
4. `CriptoVersus/tools/arena-pressure/diagnose-browserless-fps.mjs`
5. `CriptoVersus/tools/arena-pressure/capture-browserless-options.mjs`
6. `CriptoVersus/tools/arena-pressure/browserless-capture-function.mjs`

To update `/tmp/arena-pressure-phase2/` inside a running container without restarting
Browserless or touching `/tmp/arena-pressure-phase2/out/`:

```bash
for file in capture-media.mjs capture-browserless.mjs reprocess-webm.mjs diagnose-browserless-fps.mjs capture-browserless-options.mjs browserless-capture-function.mjs; do
  docker cp "CriptoVersus/tools/arena-pressure/$file" "<container>:/tmp/arena-pressure-phase2/$file"
done
docker exec "<container>" chmod 644 /tmp/arena-pressure-phase2/*.mjs
```

Operational checks before running:

- Confirm no stale `/tmp/arena-pressure-phase2/out/browserless-preview.lock` exists.
- Always pass `--output /tmp/arena-pressure-phase2/out` to `capture-browserless.mjs`
  when running via `docker exec` so artifacts do not default outside the workspace.
- Reprocess any preserved `.failed.webm` directly in place (the source `.failed.webm`
  remains untouched and an existing `.mp4` will never be overwritten):

```bash
docker exec "<container>" node /tmp/arena-pressure-phase2/reprocess-webm.mjs \
  --input /tmp/arena-pressure-phase2/out/<capture>.failed.webm
```

Browserless v1 returns only the WebM body from `/screencast`; it does not return the
function's JavaScript result. The in-browser function therefore rejects the request
unless the playhead starts at zero and advances within tolerance of 40 logical
seconds (or reaches the end). The technical JSON records that validation but leaves
the exact end playhead null rather than inventing a value.

## Full-match 120s segmented capture (Phase 3)

`CriptoVersus/tools/arena-pressure/capture-full-match.mjs` generates a single
consolidated MP4 (~120 seconds, H.264, `1280×720`, `30 FPS`, `yuv420p`, `+faststart`)
covering an entire finished historical match from start to official end without
extending global Browserless container timeouts or running concurrent sessions.

### How it works

1. **Metadata probe (`/function`)**: calls `browserlessMetadataFunction` on the
   existing Browserless `/function` endpoint using the same `X-Arena-Capture-Key`
   exact-navigation contract. Verifies that the match exists, is officially finished
   (and not cancelled), has `>= 2` historical samples, a usable historical span
   (`>= 1s`), and supports segmented seek/dynamic-speed capabilities.
2. **Dynamic speed & temporal planning (`capture-planner.mjs`)**: computes
   `replaySpeed = historicalDurationSeconds / exactTargetVideoDurationSeconds`
   (clamped safely for ultra-short matches at `0.1×` and capped at `10000×`) and
   partitions the output timeline into exact frame budgets (default 10s = 300 frames
   per segment, balancing short tails so no sliver < 2s is produced). Every segment
   boundary maps bit-for-bit from exact output frame index (`endFrame`) so segment
   `i` ends at the exact historical instant where segment `i + 1` starts.
3. **Deterministic seek & visual continuity (`engine.ts`)**: `prepareSegment()` seeks
   statelessly via `sampleHistory()`, snaps `PressureArt` immediately (bypassing
   dwell/hysteresis and crossfade tweens), clears pooled particles, awaits target
   `WheelMechanism` hub frame preloading at the continuous video clock phase, updates
   the HUD, and waits two animation frames before `startScreencast()`. During
   recording, `resolveCapturePlayhead` advances monotonically at `replaySpeed` from
   `performance.now()`, decoupled from Browserless render FPS.
4. **Sequential capture, normalization & assembly (`capture-media.mjs`)**: captures
   segments one at a time (locked via `browserless-preview.lock`), records an extra
   `0.5s` wall tail pad, validates WebM decode, and normalizes every segment MP4 to
   its exact target frame count (`setpts=PTS-STARTPTS`, `fps=30`, bounded
   `tpad=stop_mode=clone` up to `1.0s`, `-frames:v`, closed 1s GOP `-g 30 -keyint_min 30`,
   `-video_track_timescale 30000`, `-pix_fmt yuv420p`).
5. **Concatenation & strict validation**: joins segments with FFmpeg concat demuxer
   `-c copy` (falling back to a single `-threads 2` re-encode only if stream
   parameters mismatch), validates full stream decode (`-v error -xerror`), frame
   count (`±1`), monotonic frame timestamps, non-blank start/mid/end luma (`YAVG >= 2`),
   and ISO BMFF `+faststart` (`moov` before `mdat`) before atomic publication.
6. **Resilience & recovery**: persists run state atomically in
   `<output>/runs/match-<id>-<runId>/manifest.json` with a SHA-256 `planFingerprint`,
   retries transient segment failures up to `--max-retries` (default 2), and
   supports `--resume <runId>` to verify and reuse already completed segment MP4s.

### CLI & VPS hot-update

```bash
node tools/arena-pressure/capture-full-match.mjs \
  --match-id 46156 \
  --target-duration 120 \
  --width 1280 \
  --height 720 \
  --output /tmp/arena-pressure-phase2/out
```

Use `--max-segments 3` for an initial few-segment continuity test before running all
segments. Additional VPS runtime files to copy alongside the Phase 2 scripts:

- `CriptoVersus/tools/arena-pressure/capture-planner.mjs`
- `CriptoVersus/tools/arena-pressure/capture-full-match.mjs`

Note that `engine.ts` / `.20261124a.js` and `ArenaPressureGameHost.razor` /
`ArenaPressureGamePage.razor` must also be deployed to `CriptoVersus.Web` before
real segmented captures can run against production/staging.

## Future n8n phase (not implemented)

A future authenticated internal job endpoint can enqueue a match ID for a dedicated
capture worker. Because segmented full-match capture spawns multiple sequential
Browserless sessions and takes longer than a single synchronous HTTP request, that
worker should run asynchronously (`enqueue -> poll status -> read validated MP4 artifact reference`)
and hand off only validated outputs to a separate publication workflow. Queue
idempotency, service authentication, retention, and publication audit records belong
to that later phase.
