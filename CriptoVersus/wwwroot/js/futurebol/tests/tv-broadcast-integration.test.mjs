import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const futurebolRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const stage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStage.razor`, "utf8");
const host = readFileSync(`${projectRoot}/Components/Pages/Internet/TvFuturebolField.razor`, "utf8");
const hostCss = readFileSync(`${projectRoot}/Components/Pages/Internet/TvFuturebolField.razor.css`, "utf8");
const matchPage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvMatchPage.razor`, "utf8");
const matchPageCss = readFileSync(`${projectRoot}/Components/Pages/Internet/TvMatchPage.razor.css`, "utf8");
const broadcastPage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvPage.razor`, "utf8");
const desktop = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageDesktop.razor`, "utf8");
const tablet = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageTablet.razor`, "utf8");
const mobile = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageMobile.razor`, "utf8");
const fieldPanel = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageFieldPanel.razor`, "utf8");
const bootstrap = readFileSync(`${futurebolRoot}/futurebol-bootstrap.ts`, "utf8");
const babylonLoader = readFileSync(`${futurebolRoot}/futurebol-babylon-loader.ts`, "utf8");
const engine = readFileSync(`${futurebolRoot}/futurebol-engine.ts`, "utf8");
const renderer = readFileSync(`${futurebolRoot}/futurebol-renderer.ts`, "utf8");
const arena = readFileSync(`${futurebolRoot}/futurebol-arena.ts`, "utf8");
const visualFactory = readFileSync(`${futurebolRoot}/player/futurebol-player-visual-factory.ts`, "utf8");
const logoTextures = readFileSync(`${futurebolRoot}/player/futurebol-team-logo-texture.ts`, "utf8");
const camera = readFileSync(`${futurebolRoot}/futurebol-camera.ts`, "utf8");
const logoUrlResolver = readFileSync(`${projectRoot}/Services/FuturebolTeamLogoUrl.cs`, "utf8");
const webProgram = readFileSync(`${projectRoot}/Program.cs`, "utf8");
const englishI18n = JSON.parse(readFileSync(`${projectRoot}/i18n.en-US.json`, "utf8"));
const portugueseI18n = JSON.parse(readFileSync(`${projectRoot}/i18n.pt-BR.json`, "utf8"));
const chineseI18n = JSON.parse(readFileSync(`${projectRoot}/i18n.zh-CN.json`, "utf8"));

assert.ok(matchPage.includes('@page "/tv/match/{MatchId:int}/{Slug}"'));
assert.ok(matchPage.includes("<TvStage"), "Match TV must enter the shared TvStage");
assert.ok(matchPage.includes("TvProceduralCyclePolicy.FindNextMatch(hotMatches, MatchId)"), "ended fixed matches must discover a different eligible match");
assert.ok(matchPage.includes("RouteLocalization.BuildTvMatchPath"), "next-match action must reuse the localized TV match route");
assert.ok(matchPage.includes("RouteLocalization.BuildStatsMatchesPath"), "ended modal must expose the existing match listing route");
assert.ok(matchPage.includes("RouteLocalization.BuildTvPath"), "ended modal must expose the automatic TV route");
assert.ok(matchPage.includes("RouteLocalization.BuildHomePath"), "ended modal must expose the localized home route");
assert.ok(matchPage.includes("_loadState == TvMatchPageLoadState.Error"), "retry must remain limited to meaningful load failures");
assert.ok(matchPageCss.includes("backdrop-filter: blur(5px)"), "blocking match overlay must preserve blurred TV context");
assert.ok(matchPageCss.includes("rgba(2, 6, 15, .54)"), "blocking match overlay must remain translucent");
assert.ok(matchPageCss.includes("grid-template-columns: 1fr"), "mobile modal actions must stack in one column");
assert.ok(broadcastPage.includes('@page "/tv/broadcast"'));
assert.ok(broadcastPage.includes("<TvStage"), "Broadcast must enter the shared TvStage");
assert.ok(stage.includes("<TvFuturebolField"), "TvStage must render Futurebol in its FieldContent slot");
assert.equal(stage.includes("<TvCryptoFootballField"), false, "legacy field cannot remain the Stage renderer");
assert.equal(stage.includes('Config.GetValue<bool?>("CriptoVersusTV:UseFootballFieldLayout")'), false, "Futurebol cannot be gated by the legacy field feature flag");
assert.ok(desktop.includes('FieldContent="@FieldContent"'), "Desktop must forward Futurebol FieldContent");
assert.ok(tablet.includes('FieldContent="@FieldContent"'), "Tablet must forward Futurebol FieldContent");
assert.ok(mobile.includes('FieldContent="@FieldContent"'), "Mobile must forward Futurebol FieldContent");
for (const [name, layout] of [["Desktop", desktop], ["Tablet", tablet], ["Mobile", mobile]]) {
    assert.ok(layout.includes('<TvStageFieldPanel Model="@Model"'), `${name} must pass the current replay model to the shared field panel`);
}
assert.ok(fieldPanel.includes("@FieldContent"), "the field panel must render the Futurebol fragment");
assert.equal(stage.includes("initFieldSway"), false, "legacy DOM movement must not run beside Babylon");
assert.equal(stage.includes("tvCinematicCamera"), false, "legacy DOM camera must not run beside FuturebolCamera");
assert.equal(stage.includes("32061"), false, "the renderer selection cannot contain a pilot MatchId");

assert.ok(host.includes("if (!_initialized)"), "the host must initialize only once");
assert.ok(host.includes("updatePresentation"), "same-match and broadcast updates must use incremental interop");
assert.ok(host.includes('InvokeVoidAsync("dispose"'), "Blazor disposal must release the canvas instance");
assert.ok(host.includes('presentationMode = "tv"'), "TV must use renderer-only presentation mode");
assert.ok(host.includes('style="position:relative;width:100%;height:100%'), "the host must fill the TV slot even if isolated CSS is stale");
assert.ok(host.includes('style="position:absolute;inset:0;width:100%;height:100%;display:block'), "the canvas must fill the measured host instead of using its 300x150 intrinsic size");
assert.equal(/<canvas[^>]+\s(?:width|height)=/s.test(host), false, "the canvas cannot carry fixed intrinsic dimensions");
assert.ok(host.includes("@if (!_isReady"), "TV must keep its loading state until the engine reports a useful frame");
assert.ok(host.indexOf('_isReady = true') > host.indexOf('"initialize"'), "ready can only be published after initialize completes");
assert.ok(host.includes('data-futurebol-state="@FuturebolState"'), "the host must expose loading, ready and error states");
assert.ok(host.includes('@T("loading")'), "loading copy must use the localized first server-rendered host markup");
assert.ok(host.includes('@T("loadingSlow")'), "slow loading must have a localized intermediate message");
assert.ok(host.includes('@T("error")'), "fatal failure must leave a localized friendly visible state");
for (const resource of [englishI18n, portugueseI18n, chineseI18n]) {
    assert.ok(resource.tv.futurebol.loading, "Futurebol loading copy must exist in every supported culture");
    assert.ok(resource.tv.futurebol.loadingSlow, "Futurebol slow-loading copy must exist in every supported culture");
    assert.ok(resource.tv.futurebol.error, "Futurebol error copy must exist in every supported culture");
}
assert.ok(hostCss.includes('tvFuturebolSlowMessage'), "slow loading must switch without waiting for JS initialization");
assert.ok(stage.includes('HomeLogoUrl="@GetLogoUrl(DisplayLeftLogoUrl())"'), "Futurebol must receive the exact left card logo URL");
assert.ok(stage.includes('AwayLogoUrl="@GetLogoUrl(DisplayRightLogoUrl())"'), "Futurebol must receive the exact right card logo URL");
assert.ok(host.includes("[TvFuturebolField] component initialized"));
assert.ok(host.includes("[TvFuturebolField] OnAfterRender"));
assert.ok(host.includes("FuturebolTeamLogoUrl.Resolve"), "the integrated host must translate official URLs to the same-origin logo transport");
assert.ok(logoUrlResolver.includes('ProxyRoutePrefix = "/futurebol/team-logo/"'));
assert.ok(webProgram.includes('app.MapGet("/futurebol/team-logo/{symbol}"'), "the Web host must expose the same-origin logo proxy");

assert.ok(bootstrap.includes("const instances = new Map<string, FuturebolEngineContract>()"));
assert.ok(bootstrap.includes('futurebol-engine.js?v=20260820-replay-live-goal-opening-1'), "the cache-busted entry must also version its engine dependency");
assert.ok(engine.includes('futurebol-match-state.js?v=20260820-replay-live-goal-opening-1'), "the replay state machine must cross the same cache boundary as the engine");
assert.ok(engine.includes('futurebol-renderer.js?v=20260820-replay-live-goal-opening-1'), "the engine must force the current renderer through stale module caches");
assert.ok(renderer.includes('futurebol-arena.js?v=20260820-replay-live-goal-opening-1'), "the renderer must force the real arena builder through stale module caches");
assert.ok(bootstrap.includes("[FUTUREBOL-TV] canvas found"));
assert.ok(bootstrap.includes("[FUTUREBOL-TV][READY] initialize success"));
assert.ok(bootstrap.includes("let preloadPromise: Promise<void> | null = null"), "page preload must be idempotent");
assert.ok(bootstrap.includes("preloadBabylonRuntime()"), "TV must warm the Babylon runtime before field initialization");
assert.ok(bootstrap.includes("preloadPlayerAsset()"), "TV must warm the canonical GLB URL in the HTTP cache");
assert.ok(babylonLoader.includes("let runtimePreloadPromise: Promise<void> | null = null"), "Babylon preload must run once per page");
assert.ok(bootstrap.includes("await engine?.dispose()"), "failed initialization must dispose partial resources");
assert.ok(bootstrap.includes('let stage = "dispose-previous"'), "fatal diagnostics must track the active bootstrap stage");
assert.ok(bootstrap.includes('console.error("[FUTUREBOL][FATAL]"'), "fatal failures must retain structured console diagnostics");
assert.ok(bootstrap.includes("stack: error instanceof Error ? error.stack : undefined"));
for (const milestone of [
    "[FUTUREBOL] bootstrap started",
    "[FUTUREBOL] Babylon ready",
    "[FUTUREBOL] scene ready"
]) assert.ok(bootstrap.includes(milestone), `missing performance milestone: ${milestone}`);
for (const milestone of [
    "[FUTUREBOL] market/match data ready",
    "[FUTUREBOL] first frame"
]) assert.ok(engine.includes(milestone), `missing performance milestone: ${milestone}`);
for (const milestone of [
    "[FUTUREBOL] player GLB ready"
]) assert.ok(visualFactory.includes(milestone), `missing performance milestone: ${milestone}`);
for (const milestone of [
    "[Futurebol][TeamLogo]",
    "[Futurebol][LogoTexture]"
]) assert.ok(logoTextures.includes(milestone), `missing logo diagnostic: ${milestone}`);
assert.ok(engine.includes("private changeMatch("), "broadcast rotation must reconfigure an existing engine");
assert.ok(engine.includes("this.renderer.reconfigureTeams(teams)"));
assert.ok(
    engine.includes("this.options.homeLogoUrl = state.homeTeam.logoUrl")
        && engine.includes("createFuturebolTeamVisualConfiguration(this.options)"),
    "same-match updates must reconfigure shared logo materials when a URL arrives later"
);
assert.ok(engine.includes("this.state = new FuturebolMatchState"), "match state must be isolated per rotation");
assert.ok(engine.includes("new ResizeObserver"));
assert.ok(engine.includes("this.resizeObserver.observe(host)"), "resize observation must target the canvas' real layout host");
assert.ok(engine.includes("await this.settleInitialSize()"), "the engine must resize after the host has a laid-out size");
assert.ok(engine.includes("await firstFrame"), "initialize must not resolve before the first rendered frame");
assert.ok(engine.includes("this.resizeObserver?.disconnect()"), "the component must release its layout observer");
assert.ok(renderer.includes("this.camera.setViewportAspect"), "resize must update the camera framing for the measured aspect");
assert.ok(camera.includes("aspect < 1"), "portrait TV layouts must preserve horizontal field coverage");
assert.ok(renderer.includes("new FuturebolArenaRuntime"), "Match and Broadcast must use the shared stadium renderer");
assert.ok(renderer.includes("this.arena?.setQuality(quality)"), "stadium detail must follow the active quality preset");
assert.ok(arena.includes("[Futurebol][Arena] REAL_STADIUM_BUILDER_ACTIVE"), "the real shared arena builder must emit an unmistakable runtime marker");
assert.ok(arena.includes('thinInstanceSetBuffer("matrix"'), "seats and crowd must use thin instances");
assert.ok(host.includes("ReplayStateChanged"), "the Futurebol host must forward replay HUD changes to TvStage");
assert.ok(stage.includes("IsFuturebolSynchronizationReplay"), "the TV scoreboard must select replay scores only during initial catch-up");
assert.ok(fieldPanel.includes("tv-scoreboard__replay"), "the shared Match/Broadcast scoreboard must render the REPLAY badge");
assert.ok(fieldPanel.includes('@(Model.IsSynchronizationReplay ? "is-replay" : string.Empty)'), "the replay class must be removed from the DOM model in LIVE");
assert.ok(engine.includes("replayWasActive !== this.state.isSynchronizationReplay"), "REPLAY -> LIVE must notify Blazor in the transition frame");
assert.ok(engine.includes('"ReportFuturebolReplayState"'), "the engine must report the final active=false state through interop");
assert.ok(stage.includes("return InvokeAsync(StateHasChanged)"), "TvStage must render replay state changes on the Blazor UI context");
assert.ok(fieldPanel.includes("opacity: .7"), "the REPLAY badge pulse must visibly change luminosity without an aggressive flash");
assert.ok(arena.includes("Mesh.MergeMeshes"), "repeated stadium modules must be merged before rendering");
assert.equal(arena.includes("PointLight"), false, "the stadium cannot add costly per-fixture point lights");
assert.equal(arena.includes("SpotLight"), false, "the stadium cannot add costly per-fixture spot lights");
assert.equal(arena.includes("GlowLayer"), false, "the stadium glow must remain lightweight emissive geometry");

const changeMatchBody = engine.slice(engine.indexOf("private changeMatch("), engine.indexOf("public reportMarketError"));
assert.equal(changeMatchBody.includes("new FuturebolRenderer"), false, "match rotation must preserve engine and scene");
assert.equal(changeMatchBody.includes("initializePlayers"), false, "match rotation must not reload or parse the GLB");
assert.equal(changeMatchBody.includes("runRenderLoop"), false, "match rotation must not create a second RAF loop");

console.log("Futurebol Match TV and Broadcast integration tests passed.");
