# UX improvement loop

## Audit baseline

### Product map

- Public entry and live-match discovery: `CriptoVersus/Components/Pages/Internet/PublicHome.razor`.
- Shared chrome and responsive navigation: `Components/Layout/MainLayout.razor` and `NavMenu.razor`.
- Match detail and participation flow: `Pages/Internet/MatchDetail*.razor` and `MatchInvestmentModal.razor`.
- Broadcast and TV presentation: `Pages/Internet/TvPage.razor`, `TvMatchPage.razor`, and the `TvStage*` components.
- Futurebol: the official TV field is hosted by `TvFuturebolField`; `/lab/futurebol` remains the diagnostic laboratory.
- Candle Battle: `Components/Shared/CandleBattleV2.razor`, hosted by `CandleBattleV2Page.razor`.
- Rankings and market discovery: `Stats*.razor`, home coin cards, and hot-match services.

### Highest-impact findings

1. The Home repeats the primary live match in the hero's SVG field, hero card, featured card, and live grid. This dilutes the primary decision.
2. The opening hero exposes three equal navigation actions before the visitor has chosen whether to watch the active battle.
3. Home styling is largely isolated in a large inline style block, making global visual consistency costly to evolve.
4. The desktop layout switches to the mobile navigation shell at 1366px, making tablet review essential.
5. TV is rich but structurally dense; its mobile/tablet/desktop renderers are separate and shared changes need regression checks.
6. Futurebol preserves loader, error, quality, and fallback paths; its simulation and player geometry must not be changed casually.
7. Candle Battle already differentiates loading, error, reconnecting, waiting, live, and finished states; its breakpoints need visual QA rather than speculative rewrites.
8. Home has meaningful skeletons, but its initial hierarchy still feels busy because multiple panels claim the same battle.
9. The sidebar mixes product discovery and secondary destinations, increasing the need for a decisive Home hero.
10. Localization is established for English, Portuguese, and Chinese; any new visible copy must be complete in all three.

### First cycles

1. Consolidate Home's primary live battle and reduce competing hero CTAs.
2. Verify Home at phone, tablet, and desktop widths; correct real overflow or hierarchy defects found.
3. Audit the TV/Futurebol entry path and loading shells without altering authoritative score or simulation behavior.

## Cycle 1

Problem: the first viewport presents the same live match multiple times and asks a new visitor to choose among too many directions.

Evidence: `PublicHome.razor` renders `CryptoArenaFieldVisual`, `home-hot-hero`, `arena-featured-battle`, and `arena-match-grid` from the same featured/live source.

Hypothesis: one prominent live battle with one primary viewing CTA, followed by only the remaining live battles, will clarify the product within the first scroll.

Alteration: removed the redundant Home field SVG and duplicate featured card; the hero keeps the only primary live battle while the live grid now excludes it. Reduced hero navigation from three actions to a primary exploration action and one explanatory secondary action.

Tests: `dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore` passed. `npm run test:tv-charts --prefix CriptoVersus` passed. TypeScript compilation could not write pre-existing generated files because another local process holds them; no TypeScript source changed in this cycle.

Result: the initial decision is now to open the featured arena or its match page, rather than interpret duplicate scoreboards.

Next largest problem: after loading, the live section can have no explanatory state if the feed is empty or the hero is the sole live battle.

## Cycle 2

Problem: a visitor can see an empty live-match area after the skeletons disappear, without knowing whether the product is loading, empty, or unavailable.

Evidence: the live grid only rendered skeletons or match cards.

Hypothesis: an explicit state that distinguishes the sole live battle from no current live battle will make the page feel intentional and provide a clear next action.

Alteration: added localized empty and sole-live states that guide the visitor to top battles.

Tests: localization JSON parsed successfully. The first build attempt was blocked by the local review server holding its executable; after stopping that server, `dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore` and `npm run test:tv-charts --prefix CriptoVersus` passed.

Result: loading, one-live-match, and no-live-match states now communicate their meaning and a next step.

Next largest problem: the hero explains the product through a long paragraph plus five competing chips before the visitor reaches the live battle.

## Cycle 3

Problem: the Home hero is text-heavy for a first visit, especially on mobile.

Evidence: one long description and five semantic chips appear alongside the primary live arena.

Hypothesis: a concise value proposition and three scannable product signals will answer what CriptoVersus is without pushing the live battle downward.

Alteration: shortened the localized hero description and reduced the visible explanatory chips from five to three.

Tests: `dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore` passed; all localization JSON files parsed; `npm run test:tv-charts --prefix CriptoVersus` passed. The Home returned HTTP 200 from the local server; it rendered two hero actions and no `CryptoArenaFieldVisual` markup. Browser screenshot automation was unavailable in this environment, so the 375–1440px visual pass remains a follow-up validation rather than a claimed result.

Result: the first screen now states what the product is, presents one featured battle, and preserves a single clear continuation path without redundant visualizations.

Remaining high-impact follow-ups: verify the rendered Home at 375, 390, 430, 768, 1024, and 1440px when browser automation is available; then review the TV/Futurebol entry path and the mobile navigation breakpoint at 1366px.

## Cycle 4

Problem: Futurebol's terminal 3D-loading error leaves the viewer with only a page-refresh instruction, even when a fresh visual-engine initialization may recover the broadcast.

Evidence: `TvFuturebolField` stopped after `MaxInitRetries` and rendered an informational fallback without an action. The TV and match-TV participation actions already call `MatchInvestmentModal.OpenAsync` directly, so no route change is required for the “Choose” flow.

Hypothesis: retrying the isolated visual engine, while retaining the existing official presentation input, gives a recoverable error state without affecting the replay state machine or persisted scoring.

Alteration: added an accessible localized retry action to the Futurebol fallback. It resets only the visual initialization state, schedules a safe disposal of any existing JavaScript engine instance, and lets the established initialization path run again with the same match presentation. The `BOOTSTRAP_PENDING → REPLAY → LIVE` logic, score callbacks, player geometry, and adaptive quality selection are unchanged.

Files: `TvFuturebolField.razor`, `TvFuturebolField.razor.css`, and all three localization files.

Validation: `dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore` passed with zero warnings/errors; localization JSON parsed; TV chart tests and the Futurebol regression set passed. `npm run test:futurebol` cannot run its initial `tsc` step because another local process locks existing generated `wwwroot/js/dist` files; no product TypeScript changed in this cycle.

Result: viewers can retry the visual engine in place instead of abandoning the broadcast, while official state and replay behavior remain unchanged.

Next largest problem: the participation modal is reached directly from TV, but its long form needs a static small-viewport audit to guarantee its close, amount, wallet, and submit controls remain usable on short phone screens.

## Cycle 5

Problem: Candle Battle can briefly show the authoritative score in its header while its animated block piles and pile labels intentionally show the replayed presentation score.

Evidence: the header and leader treatment read `MatchDto.CandleBattle*Wins`; the two block piles read `CandleBattleV2StateAdapter.DisplayScore*`. During queued live events or recovery playback, these sources can be temporarily different.

Hypothesis: all presentation elements should read the adapter's display score so the score header, leader state, block count, and “points” labels advance as one visible system, while the adapter continues to reconcile to the official score after playback.

Alteration: changed the Candle Battle header scores and leader class to use the existing display scores. No scoring calculation, event acceptance, persistence, animation queue, or official-state reconciliation was changed.

Files: `CandleBattleV2.razor`.

Validation: the Web build passed with zero warnings/errors and the Futurebol integration, official-state, hardening, and TV broadcast tests passed.

Result: the visible Candle Battle score, leader indicator, block count, and block label now stay synchronized during animation and recovery before reconciling to the same official result.

Next largest problem: the direct participation modal needs a short-phone static layout guard so all actions remain reachable without relying on a browser-only review.

## Cycle 6

Problem: the direct TV/Futurebol participation modal relies on default modal sizing, so a short phone viewport can leave the amount form and footer actions competing for vertical space.

Evidence: `MatchInvestmentModal` has a header, wallet summary, amount presets, range, numeric input, validation, and footer actions, but no component-level maximum viewport height or explicit body overflow behavior.

Hypothesis: bounding the modal content to the dynamic viewport and assigning overflow to its body keeps the close, amount, wallet, cancel, and confirm controls reachable on small or landscape phones.

Alteration: added a bounded dialog width, dynamic-viewport content cap, and scrollable modal body. Narrow-phone padding is reduced and the wallet summary becomes one column below 380px. Validation, transaction constraints, and the direct TV/Futurebol modal invocation are unchanged.

Files: `MatchInvestmentModal.razor`.

Validation: the Web build passed with zero warnings/errors; TV chart tests and all supported localization JSON parsing passed. Browser screenshot automation remains unavailable, so this is a source-level responsive correction rather than a claim of rendered-device validation.

Result: the modal now has an explicit short-screen scroll path and preserves its primary actions within the viewport.

Next largest problem: run the relevant build, Futurebol/TV regression suite, localization parsing, and diff review; then retain visual-device checks for the next environment with working browser automation.

## Cycle 7

Problem: the TV route preloaded `futurebol-bootstrap` at one module-cache revision and the integrated Futurebol field imported it at another.

Evidence: `TvStage` used the older `20260822-official-goal-field-1` query value for both module preload and the shared preload call, while `TvFuturebolField` initializes the active `20260907-led-v2` module. Module query strings are cache identities, so the warm-up could not reliably be reused by the visible field.

Hypothesis: one active cache identity throughout the TV path avoids duplicate module initialization and lets the preloading work benefit the field that viewers actually see.

Alteration: aligned the TV stage's module preload and JavaScript preload import to `20260907-led-v2`, the same revision used by `TvFuturebolField`. Updated the regression assertion for the corresponding versioned engine dependency. The replay state machine, renderer, player quality, and engine code remain unchanged.

Files: `TvStage.razor` and `tv-broadcast-integration.test.mjs`.

Validation: the TV/Futurebol broadcast integration test passed after the cache alignment; the complete direct Node Futurebol regression set and Web build passed. The test was updated from two stale literal version expectations to the active v2 cache boundaries and from an indentation-sensitive CSS assertion to a semantic one.

Result: the TV preload and visible Futurebol field now share one cache identity, avoiding redundant bootstrap warm-up work.

Next largest problem: final regression run and diff review; browser-rendered validation remains deferred because browser automation is unavailable in this environment.

## Cycle 8

Problem: the journey from Home to the broadcast was split across tabs, while the dedicated Candle Battle route had no visible route back to the match or TV.

Cause: internal TV links used `target="_blank"`, and `CandleBattleV2Page` hosted the component without journey navigation.

Alteration: changed internal arena links to continue in the same tab and added localized, responsive Candle Battle links back to the public match and its TV presentation. No score, match, or participation rule changed.

Files: `PublicHome.razor`, `CandleBattleV2Page.razor`, `CandleBattleV2Page.razor.css`, and the three localization catalogs.

Validation: Web build, Futurebol broadcast/official-state regressions, TV chart tests, JSON parsing, and `git diff --check` passed before the later interrupted validation batch.

Result: Home → match/TV → Candle Battle now retains a clear, same-tab continuation and return path.

Next largest problem: reduce broadcast diagnostics that compete with live viewing on the public TV route.

## Cycle 9

Problem: the first 30 seconds needed a product-hierarchy check after Home consolidation without reintroducing duplicated calls to action.

Cause: the product explanation, featured live card, and navigation had recently been simplified and needed a static continuity review.

Alteration: audited the rendered-source hierarchy and retained the existing concise proposition, three product signals, one hero continuation, and the featured live match actions. No speculative Home change was made.

Files: reviewed `PublicHome.razor` and localized Home copy.

Validation: static source review confirmed the hero now communicates the arena, live score/momentum, and two concrete in-product continuations without the previous duplicated field/card blocks.

Result: the first-use hierarchy remains intentionally focused; device rendering remains a human visual-validation follow-up.

Next largest problem: public TV still displayed development audio controls and an automatic-broadcast label on fixed-match TV pages.

## Cycle 10

Problem: diagnostic audio controls and an automatic-broadcast label added noise to public TV, including fixed-match pages where that label was misleading.

Cause: TV wrappers always received the diagnostic label/button properties, and `TvStageTopbar` always rendered populated controls.

Alteration: expose audio diagnostics only in Development, make the automatic-broadcast label conditional on broadcast mode, and keep internal match navigation in the current tab. Actual crowd-audio controls remain public.

Files: `TvStage.razor`, `TvStageTopbar.razor`, and `tv-broadcast-integration.test.mjs`.

Validation: relevant Futurebol broadcast, official-state, hardening, and quality tests passed; TV chart tests, catalog parsing, and diff check also passed.

Result: public TV prioritizes the match and actual arena controls rather than technical diagnostics.

Next largest problem: the canonical match route can render nothing during resolution and both match-detail layers exposed raw exception messages.

## Cycle 11

Problem: public match detail did not communicate all loading and recovery states safely. The canonical route could be blank while resolving metadata; failures rendered `ex.Message`, and the nested detail loader could automatically attempt the same failed route again after rerendering.

Cause: `MatchDetailRoute` used a single error string with no loading/not-found state; `MatchDetail` used raw exception text and had no failure-route guard.

Alteration: added localized loading, unavailable, not-found, retry, and return-to-live states to the canonical route. The nested detail now logs the exception with structured context, stores only an internal failure marker for UI branching, blocks automatic repeat attempts for the failed route, and clears that guard exclusively when the user chooses Retry. A not-found response is marked as loaded rather than treated as an exception. No match data, scoring, clock, participation, or settlement logic changed.

Files: `MatchDetailRoute.razor`, `MatchDetail.razor`, `i18n.pt-BR.json`, `i18n.en-US.json`, and `i18n.zh-CN.json`.

Validation: the original execution was interrupted during its validation batch, so this cycle was not accepted at implementation time. Validation was resumed on 2026-09-25: `dotnet build CriptoVersus/CriptoVersus.Web.csproj --no-restore` passed with zero warnings/errors; Futurebol TV broadcast, official-state, hardening, and player-quality invariant regressions passed; `npm run test:tv-charts --prefix CriptoVersus` passed; all three JSON catalogs parsed; `git diff --check` passed. A first resumed test command referenced a non-existent `player-quality-selector.test.mjs`; this was corrected to the repository's actual `player-quality-invariant.test.mjs` before the accepted run.

Result: visitors see a loading state rather than a blank page, receive understandable localized recovery choices rather than technical exception text, Retry makes a new deliberate attempt, and failures no longer self-loop after rerender.

Next largest problem: static mobile and large-desktop audit of the public match/TV/Candle/participation flow, with implementation only for reproducible layout or action-reachability defects.

## Cycle 12

Problem: the large desktop broadcast could crop its own content on a short-height window.

Cause: above 1180px, `TvStageDesktop` requested both a fixed `calc(100svh - 42px)` scene and an unconditional `min-height: 640px`; CSS resolves an impossible min/max pair in favor of the minimum, while the parent intentionally uses hidden overflow.

Alteration: capped the desktop minimum at the actual available viewport height with `min(640px, calc(100svh - 42px))`. Added a TV integration assertion so a fixed-height scene cannot regress to a larger hard-coded minimum.

Files: `TvStageDesktop.razor` and `tv-broadcast-integration.test.mjs`.

Validation: Web build completed with 0 errors; the full compilation reported 35 pre-existing warnings outside this change. Futurebol broadcast, official-state, hardening, and player-quality invariant tests passed; TV chart tests, the three catalog parses, match recovery/localization invariants, and `git diff --check` passed.

Result: a wide but short desktop now keeps the broadcast scene within its own clipping boundary instead of hiding a portion of its field or telemetry.

Next largest problem: rendered-device validation at phone, tablet, and desktop widths. Static inspection found explicit scroll/stacking safeguards for MatchInvestmentModal, TV state cards, Candle Battle, and mobile TV; no further source-only issue was sufficiently reproducible to justify another speculative layout change.
