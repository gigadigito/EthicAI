# Futurebol LED Advertising v1

The foreground blue area is the near stand canopy, not empty ground. Boards at pitch level were hidden by it. The final boards are fixed to that structure, not parented to the camera, and do not modify the pitch, players, goals or camera director.

## Final geometry

- Span: 18 world units, derived from `FUTUREBOL_FIELD.halfLength * 0.72`.
- Centers: Y=10.05, Z=-20.8 (field half-width plus 5.8).
- Body height: 1.02, depth: 0.16; face height: 0.92.
- Pitch: +0.55 radians (31.5 degrees), facing the elevated negative-Z camera.
- Gap: 0.28 between bodies. Medium/Low body width 5.72; High 3.32.
- The final face is 28% taller than the earlier 0.72 face. Moving the mount slightly upward and back clears the canopy without pushing the top edge into the field in Broadcast.

| Quality | Boards | Canvas requested per board |
|---|---:|---:|
| High | 5 | 1024 × 192 |
| Medium | 3 | 768 × 96 |
| Low | 3 | 512 × 64 |

## Content and ownership

`futurebol-led-advertising.ts` owns geometry, messages, rasterization, rotation and disposal. Renderer integration supplies the existing `latestSnapshot.home/away` assets and document locale. Engine callbacks supply the existing official status and market snapshots. The Lab debug panel shows count, rotation, current text, uploads and cached extra symbols; public TV receives no debug overlay.

Home and away occupy alternating market slots. A five-second deterministic cycle per board is staggered by 0.7 seconds, with different initial slots. Non-market slots rotate brand, team names, short localized phrases, official status, and optional headlines. When available, extra coin snippets replace alternating phrase slots. Home/away recurrence is tested over rolling fifteen-second windows across the board set.

Additional coins come only from market snapshots already received by this engine, including earlier matches in rotating Broadcast. The bounded cache retains at most sixteen symbols for five minutes after receipt, excludes current home/away, and is cleared on disposal. These are last-observed quotes, not a separate live market feed. A fresh single-match session can have no extras: it shows phrases instead. No fallback prices are manufactured. The visual fixture injects clearly simulated SOL/DOGE observations to test that path; those values are not production fallback data.

Logo drawing borrows the existing `futurebol-home/away-logo-material` DynamicTexture canvas. The player provider handles loading and symbol fallback. Extra coins use text only; no extra logo requests are made. Team border colors are read from existing player team materials; percentage colors depend on sign. Prices follow the current bubble precision policy (2/3/4 decimal places by magnitude), with grouping; the bubble itself is unchanged. Invalid values show an em dash.

Internal phrases support pt/en/zh using `document.documentElement.lang`, with English fallback. Brand/ticker/price text is universal. Official status is passed through as supplied. Existing TV narration/commentary lives in the Blazor TV host, outside the Futurebol market contract; v1 does not import it or claim an external news feed. `headlines` remains an optional input.

## Rendering and lifecycle

Near-black body/canvas, subtle border and scan lines; no GlowLayer or additional lights. Babylon StandardMaterial adds emissive color to its texture, so the color is black and the texture level supplies brightness up to 0.85. A 180ms fade on either side of each content change gives a 360ms transition. Reduced-motion keeps steady brightness. Texture redraw/upload happens only when a board's slot changes, not per frame. No marquee, timers, or module-owned observers. Quality changes dispose/recreate board resources. Final disposal is idempotent and preserves borrowed logo textures.

## Validation

The browser fixture `CriptoVersus/wwwroot/js/futurebol/tests/led-advertising.visual.html` runs the actual Babylon runtime, engine, arena, camera director and GLB with deterministic mock market data. It is a standalone local harness, not a validation of live API transport or the complete Blazor TV page. Its camera selector overrides presentation inputs only in the test fixture to hold each real director mode for inspection.

- Broadcast: the complete row is visible, with readable text, dark material and separation from the field; market/logo/fallback and rotation observed.
- Attack: the foreground row is partly outside the cropped camera view; no new obstruction of the action.
- ShotTracking and GoalCelebration: close framing can move the fixed row entirely out of view. The boards stay fixed; no camera-following workaround is used. Visibility in every close-up is not guaranteed.
- Desktop fixture observed about 100 FPS after warm-up. This is not an isolated before/after benchmark or proof of performance on physical mobile hardware.

Verification: TypeScript build passed. All 22 Futurebol test files were executed individually: 21 passed, one existing TV CSS-string assertion failed. `tv-broadcast-integration.test.mjs:58` expects LF in `.tv-fixed-audio-test`, while the unchanged `TvStage.razor` checkout uses CRLF; the same assertion succeeds when the string is normalized in memory. No TV CSS fix was made. The aggregate npm command stops at that assertion. Web build passed with 0 errors and 100 existing warnings.
