import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const futurebolRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const stage = readFileSync(`${projectRoot}/Components/Pages/Internet/TvStage.razor`, "utf8");
const host = readFileSync(`${projectRoot}/Components/Pages/Internet/TvFuturebolField.razor`, "utf8");
const bootstrap = readFileSync(`${futurebolRoot}/futurebol-bootstrap.ts`, "utf8");
const engine = readFileSync(`${futurebolRoot}/futurebol-engine.ts`, "utf8");

assert.ok(stage.includes("<TvFuturebolField"), "TvStage must render Futurebol in its FieldContent slot");
assert.equal(stage.includes("<TvCryptoFootballField"), false, "legacy field cannot remain the Stage renderer");
assert.equal(stage.includes("initFieldSway"), false, "legacy DOM movement must not run beside Babylon");
assert.equal(stage.includes("tvCinematicCamera"), false, "legacy DOM camera must not run beside FuturebolCamera");
assert.equal(stage.includes("32061"), false, "the renderer selection cannot contain a pilot MatchId");

assert.ok(host.includes("if (!_initialized)"), "the host must initialize only once");
assert.ok(host.includes("updatePresentation"), "same-match and broadcast updates must use incremental interop");
assert.ok(host.includes('InvokeVoidAsync("dispose"'), "Blazor disposal must release the canvas instance");
assert.ok(host.includes('presentationMode = "tv"'), "TV must use renderer-only presentation mode");

assert.ok(bootstrap.includes("const instances = new Map<string, FuturebolEngine>()"));
assert.ok(bootstrap.includes("await engine?.dispose()"), "failed initialization must dispose partial resources");
assert.ok(engine.includes("private changeMatch("), "broadcast rotation must reconfigure an existing engine");
assert.ok(engine.includes("this.renderer.reconfigureTeams(teams)"));
assert.ok(engine.includes("this.state = new FuturebolMatchState"), "match state must be isolated per rotation");
assert.ok(engine.includes("new ResizeObserver"));

const changeMatchBody = engine.slice(engine.indexOf("private changeMatch("), engine.indexOf("public reportMarketError"));
assert.equal(changeMatchBody.includes("new FuturebolRenderer"), false, "match rotation must preserve engine and scene");
assert.equal(changeMatchBody.includes("initializePlayers"), false, "match rotation must not reload or parse the GLB");
assert.equal(changeMatchBody.includes("runRenderLoop"), false, "match rotation must not create a second RAF loop");

console.log("Futurebol Match TV and Broadcast integration tests passed.");
