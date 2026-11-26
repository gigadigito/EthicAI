# Candle Battle video pipeline

This pipeline reuses the already persisted Candle Battle rounds and the existing
social candidate/publication API. It never reads live SignalR data during capture.
Historical Money Flow is intentionally absent because the current retention is an
in-memory presentation buffer, not an auditable match history.

## Capture surface

`/{culture}/tv/candle-battle/{matchId}/match?mode=videoCapture` is guarded by the
same fail-closed capture middleware and `X-Arena-Capture-Key` used by Arena Pressure.
It exposes `window.__candleBattleCapture` only in video mode. `getState()` reports
state, match ID, finished flag, source duration, persisted history count, output
elapsed time, render progress, error and verified final score. `start()`, `pause()`
and round-boundary `seek()` drive the existing Candle Battle replay engine.

## VPS installation (inactive first)

1. Back up the current stack scripts and n8n workflow export.
2. Copy `tools/candle-battles/capture-full-candle-battle.mjs`, the unchanged shared
   `tools/arena-pressure/capture-media.mjs` as `capture-media.mjs`,
   `browserless-video-function.mjs`, `candle-battle-publish.sh`, and
   `publication-utils.mjs` into `/home/admin/stacks/binance-square/candle-battle-tools/`.
3. Copy the shared `tools/arena-pressure/capture-media.mjs` beside the existing Arena
   tools; do not replace Browserless, FFmpeg or Docker images.
4. `chmod 750 candle-battle-publish.sh`; keep the publication root owned by the
   automation account. Set `CANDLE_BATTLE_TOOLS_ROOT` if a different path is used.
5. Retain the common Browserless output directory
   `/tmp/arena-pressure-phase2/out`. Its `browserless-preview.lock` is the global
   mutual-exclusion lock for both modalities.
6. Import `Itens de Solução/n8n/CriptoVersus_Candle_Battle_AUTO_6h_FIRECRAWL.json`,
   bind the existing SSH, API Header Auth and Firecrawl Header Auth credentials,
   inspect every URL/path, and leave it inactive.

## Dry validation

```bash
bash candle-battle-publish.sh preflight
node capture-full-candle-battle.mjs --match-id MATCH_ID --output /tmp/arena-pressure-phase2/out
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames \
  -show_entries format=duration -of json candle-battle-match-MATCH_ID-RUN.mp4
bash candle-battle-publish.sh cleanup-posted MATCH_ID v1 --dry-run
```

Expected MP4 invariants are H.264, 1280×720, yuv420p, 30/1, 3600 frames and
120 seconds. Do not invoke `publish ... CONFIRM_PUBLISH` during homologation.
Activate the cron only after a real completed match produces a visually reviewed
MP4 and reserve/unknown reconciliation has been exercised in staging.
