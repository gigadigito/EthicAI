import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const futurebolRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const stage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStage.razor`, "utf8");
const host = readFileSync(`${projectRoot}/Components/Pages/Internet/TvFuturebolField.razor`, "utf8");
const hostCss = readFileSync(`${projectRoot}/Components/Pages/Internet/TvFuturebolField.razor.css`, "utf8");
const matchPage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvMatchPage.razor`, "utf8");
const broadcastPage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvPage.razor`, "utf8");
const desktop = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageDesktop.razor`, "utf8");
const tablet = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageTablet.razor`, "utf8");
const mobile = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageMobile.razor`, "utf8");
const fieldPanel = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStageFieldPanel.razor`, "utf8");
const bootstrap = readFileSync(`${futurebolRoot}/futurebol-bootstrap.ts`, "utf8");
const babylonLoader = readFileSync(`${futurebolRoot}/futurebol-babylon-loader.ts`, "utf8");
const engine = readFileSync(`${futurebolRoot}/futurebol-engine.ts`, "utf8");
const renderer = readFileSync(`${futurebolRoot}/futurebol-renderer.ts`, "utf8");
const visualFactory = readFileSync(`${futurebolRoot}/player/futurebol-player-visual-factory.ts`, "utf8");
const camera = readFileSync(`${futurebolRoot}/futurebol-camera.ts`, "utf8");

assert.ok(matchPage.includes('@page "/tv/match/{MatchId:int}/{Slug}"'));
assert.ok(matchPage.includes("<TvStage"), "Match TV must enter the shared TvStage");
assert.ok(broadcastPage.includes('@page "/tv/broadcast"'));
assert.ok(broadcastPage.includes("<TvStage"), "Broadcast must enter the shared TvStage");
assert.ok(stage.includes("<TvFuturebolField"), "TvStage must render Futurebol in its FieldContent slot");
assert.equal(stage.includes("<TvCryptoFootballField"), false, "legacy field cannot remain the Stage renderer");
assert.equal(stage.includes('Config.GetValue<bool?>("CriptoVersusTV:UseFootballFieldLayout")'), false, "Futurebol cannot be gated by the legacy field feature flag");
assert.ok(desktop.includes('FieldContent="@FieldContent"'), "Desktop must forward Futurebol FieldContent");
assert.ok(tablet.includes('FieldContent="@FieldContent"'), "Tablet must forward Futurebol FieldContent");
assert.ok(mobile.includes('FieldContent="@FieldContent"'), "Mobile must forward Futurebol FieldContent");
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
assert.ok(host.includes("Carregando arena..."), "loading copy must exist in the first server-rendered host markup");
assert.ok(host.includes("A arena está demorando um pouco mais para carregar..."), "slow loading must have an intermediate message");
assert.ok(host.includes("Não foi possível carregar a arena 3D."), "fatal failure must leave a friendly visible state");
assert.ok(hostCss.includes('tvFuturebolSlowMessage'), "slow loading must switch without waiting for JS initialization");
assert.ok(stage.includes('HomeLogoUrl="@GetLogoUrl(DisplayLeftLogoUrl())"'), "Futurebol must receive the exact left card logo URL");
assert.ok(stage.includes('AwayLogoUrl="@GetLogoUrl(DisplayRightLogoUrl())"'), "Futurebol must receive the exact right card logo URL");
assert.ok(host.includes("[TvFuturebolField] component initialized"));
assert.ok(host.includes("[TvFuturebolField] OnAfterRender"));

assert.ok(bootstrap.includes("const instances = new Map<string, FuturebolEngine>()"));
assert.ok(bootstrap.includes("[FUTUREBOL-TV] canvas found"));
assert.ok(bootstrap.includes("[FUTUREBOL-TV][READY] initialize success"));
assert.ok(bootstrap.includes("let preloadPromise: Promise<void> | null = null"), "page preload must be idempotent");
assert.ok(bootstrap.includes("preloadBabylonRuntime()"), "TV must warm the Babylon runtime before field initialization");
assert.ok(bootstrap.includes("preloadPlayerAsset()"), "TV must warm the canonical GLB URL in the HTTP cache");
assert.ok(babylonLoader.includes("let runtimePreloadPromise: Promise<void> | null = null"), "Babylon preload must run once per page");
assert.ok(bootstrap.includes("await engine?.dispose()"), "failed initialization must dispose partial resources");
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
    "[FUTUREBOL] player GLB ready",
    "[FUTUREBOL] token textures ready"
]) assert.ok(visualFactory.includes(milestone), `missing performance milestone: ${milestone}`);
assert.ok(engine.includes("private async changeMatch("), "broadcast rotation must reconfigure an existing engine");
assert.ok(engine.includes("await this.renderer.reconfigureTeams(teams)"));
assert.ok(engine.includes("this.state = new FuturebolMatchState"), "match state must be isolated per rotation");
assert.ok(engine.includes("new ResizeObserver"));
assert.ok(engine.includes("this.resizeObserver.observe(host)"), "resize observation must target the canvas' real layout host");
assert.ok(engine.includes("await this.settleInitialSize()"), "the engine must resize after the host has a laid-out size");
assert.ok(engine.includes("await firstFrame"), "initialize must not resolve before the first rendered frame");
assert.ok(engine.includes("this.resizeObserver?.disconnect()"), "the component must release its layout observer");
assert.ok(renderer.includes("this.camera.setViewportAspect"), "resize must update the camera framing for the measured aspect");
assert.ok(camera.includes("aspect < 1"), "portrait TV layouts must preserve horizontal field coverage");

const changeMatchBody = engine.slice(engine.indexOf("private async changeMatch("), engine.indexOf("public reportMarketError"));
assert.equal(changeMatchBody.includes("new FuturebolRenderer"), false, "match rotation must preserve engine and scene");
assert.equal(changeMatchBody.includes("initializePlayers"), false, "match rotation must not reload or parse the GLB");
assert.equal(changeMatchBody.includes("runRenderLoop"), false, "match rotation must not create a second RAF loop");

console.log("Futurebol Match TV and Broadcast integration tests passed.");
