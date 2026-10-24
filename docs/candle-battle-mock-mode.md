# Candle Battle Mock Mode (Development)

Local simulation of the full Candle Battle visual flow — Arena, Replay, final
result and the social capture screens — without the API, SignalR, Binance or any
production service. Real and fictional matches share the same Phaser engine,
animations, combat rules and Blazor components.

## How to enable

The mock is opt-in and works only in `Development`:

```powershell
# option A: environment variable (no file edits)
$env:CandleBattle__Mock__Enabled = "true"
dotnet run --project CriptoVersus\CriptoVersus.Web.csproj --no-launch-profile --urls http://localhost:5287

# option B: appsettings.Development.json -> CandleBattle:Mock:Enabled = true
```

Configuration (`CandleBattle:Mock`):

| Key | Default | Meaning |
|---|---|---|
| `Enabled` | `false` | Master switch. Ignored outside Development. |
| `Scenario` | `complete-match` | Default scenario on `/dev/candle-battle`. |
| `AutoPlay` | `true` | Whether a fictional match starts playing alone. |
| `PlaybackSpeed` | `1.0` | Initial replay speed (1/2/5/10). |

In Production the mock is hard-blocked even when `Enabled=true`, and
`/dev/candle-battle/*` answers HTTP 404 before any component runs. No query
string or request can flip the mode at runtime.

## Scenarios (fixtures)

`CriptoVersus/mock-data/candle-battles/scenarios/*.json` (versioned, excluded
from publish). Each scenario owns a unique fictional MatchId and is resolved by
MatchId only; state is never shared between tabs, users or matches.

| Scenario | MatchId | Pair | State | Story |
|---|---|---|---|---|
| `bullish-vs-bearish` | 910001 | BTC vs ETH | finished | green side wins most confrontations |
| `bullish-vs-bullish` | 910002 | BTC vs BNB | finished | larger green candle beats the smaller |
| `bearish-vs-bearish` | 910003 | ETH vs BTC | finished | smaller red candle defeats the larger |
| `reversal` | 910004 | BTC vs ETH | finished | right leads early, left comes back |
| `volatility` | 910005 | SOL vs BNB | live 14/18 | wide wicks, match in progress |
| `complete-match` | 910006 | BTC vs ETH | finished | draws + decisive winner (capture default) |
| `waiting-start` | 910007 | BTC vs BNB | waiting | first candle still forming |

Fixtures store raw OHLCV (20 history + 18 match five-minute candles per asset).
Winners, strengths and scores are computed at load time by
`BLL.NFTFutebol.CandleBattlesResolver` — the production combat rules (higher
return wins; strength is the tie-breaker; green beats red; larger green beats
smaller green; smaller red beats larger red). Regenerate with:

```powershell
$env:CANDLE_BATTLE_FIXTURES = "regenerate"
dotnet test "CriptoVersus.API.Tests\CriptoVersus.API.Tests.csproj" --filter "Fixtures_on_disk_match_the_deterministic_generator"
```

The generator is closed-form (no RNG); regeneration always yields identical
bytes and identical battles.

## Routes

| URL | Screen |
|---|---|
| `/dev/candle-battle?match=910006&culture=pt` | Arena + control panel |
| `/dev/candle-battle/replay/910006?culture=pt` | Replay + control panel |
| `/dev/candle-battle/social/910006?culture=pt` | Full social card (production component) |
| `/dev/candle-battle/social/910006?mode=socialCompact` | 1200x675 capture poster (n8n layout) |

Capture frame pinning (deterministic screenshot instant):

```
/dev/candle-battle/social/910006?mode=socialCompact&captureRound=5&capturePhase=COLLISION
```

`captureRound` is the 0-based confrontation; `capturePhase` accepts
`SPAWNING, APPROACHING, ATTACKING, COLLISION, DESTROYING, VICTORY,
BLOCK_FALLING, BLOCK_LOCKING, ROUND_COMPLETE` (empty = final frame).

## Control panel

- **Scenarios** — every fixture with pair, state and score; links to arena,
  replay, social and compact capture of that same MatchId.
- **Playback** — Play, Pause, Restart, Previous/Next candle, Go to start, Jump
  to final result, Replay confrontation N (repeatable), speed 1x/2x/5x/10x,
  Freeze sprites / Resume (hold a pose and inspect it).
- **Sprite inspector** — live engine payload: phase, animation
  (`idle/run/punch/break/recover`), current frame name, positions, geometry,
  focus round, replay clock, errors (`sprite_load`, `module_import`, ...).

Playback state lives in the page's engine instance: restarting or stepping one
match never affects another. The `MOCK MODE` badge appears only in the dev
chrome, outside the capture element.

## Running a full 90-minute match

1. Open `/dev/candle-battle/replay/910006` (18 five-minute candles).
2. `Play` runs the simulated clock at 1x (90 simulated minutes); use 2x/5x/10x
   to compress wall time. The five-minute countdown and match clock follow the
   same simulation clock as the animations.
3. After the 18th candle the engine resolves the final result, plays the final
   animation and marks the match finished; `Restart` or `Replay confrontation`
   replays it as often as needed.
4. `Jump to final result` skips straight to the end state.

## Social capture screenshots

1. `Open social compact capture` from the panel (optionally pinning round/phase).
2. The page waits for sprites, logos, Phaser init and one fully rendered frame,
   then signals `data-capture-frame="frozen"` on
   `#candle-battle-social-capture[data-social-ready="true"]` — the same contract
   the n8n workflow uses (`docs/n8n-candle-battle-social.md`).
3. Screenshot that element (1200x675). For a scripted local run:

```powershell
node tools/candle-battles/social-capture-stub-api.mjs   # optional stub API
dotnet run --project CriptoVersus\CriptoVersus.Web.csproj --no-launch-profile
node tools/candle-battles/social-capture-validate.mjs   # BASE_URL=http://localhost:5287
```

Simulated social previews are marked `mock_preview`, `CanPost=false`, with no
publication state and no public URL — the mock can never create reservations,
webhooks or n8n publications.

## Tests

```powershell
dotnet test "CriptoVersus.API.Tests\CriptoVersus.API.Tests.csproj"   # mock + scenario suites
dotnet test "EthicAI.test\EthicAI.test.csproj"
dotnet test "CriptoVersus.Worker.Tests\CriptoVersus.Worker.Tests.csproj"
npm run test:candle-battles --prefix CriptoVersus           # model/dialogue/readiness
npm run test:candle-battles:visual --prefix CriptoVersus    # Playwright incl. dev timeline + captureTarget
dotnet build "EthicAI.sln"
```

Covered: default-off, production block, no HTTP/database calls, no persistence,
no publishable social state, candle temporal integrity, combat-rule winners,
90-minute closure, deterministic reproduction, Arena/Replay/Social consistency,
real DTO contract compatibility, seek/step residue-free state, freeze/inspect,
repeatable confrontations and pinned capture frames.

## Verifying Production is untouched

- `CandleBattleMockOptions.IsAllowed` is the only activation point
  (`Enabled && Environment.IsDevelopment()`); unit tests cover default-off and
  the Production block (`CandleBattleMockModeTests`).
- With `ASPNETCORE_ENVIRONMENT=Production` (even with `Enabled=true`):
  `GET /dev/candle-battle` → **404**; `/dev/candle-battle/social/...` → **404**.
- `MockCandleBattleDataSource` throws if constructed outside Development and
  serves only fixture MatchIds; fictional matches are never persisted anywhere.
- API, Worker, DAL and publishers are unchanged; production pages keep using
  `RealCandleBattleDataSource` (the previous `CriptoVersusApiClient` calls).
