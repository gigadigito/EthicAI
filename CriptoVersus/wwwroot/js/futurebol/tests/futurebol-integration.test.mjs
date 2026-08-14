import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiMarketSource } from '../../dist/futurebol/market/api-market-source.js';
import { createFuturebolMarketSource } from '../../dist/futurebol/market/futurebol-market-source-factory.js';
import { MockMarketSource } from '../../dist/futurebol/market/mock-market-source.js';
import { createFuturebolTeamVisualConfiguration } from '../../dist/futurebol/futurebol-team-configuration.js';
import { FuturebolTeamLogoTextureProvider } from '../../dist/futurebol/player/futurebol-team-logo-texture.js';

const snapshot = {
    sequence: 7,
    timestamp: '2026-07-29T12:00:00.000Z',
    home: { symbol: 'SOL', price: 182.4, changePercent: 2.1, momentum: 68, volumeStrength: 61 },
    away: { symbol: 'XEC', price: .000031, changePercent: -.8, momentum: 32, volumeStrength: 39 }
};
const options = {
    dataMode: 'api',
    homeSymbol: 'SOL',
    awaySymbol: 'XEC',
    homeLogoUrl: 'https://resolved.test/sol',
    awayLogoUrl: 'https://resolved.test/xec',
    matchId: 321,
    initialMarketSnapshot: snapshot,
    dataError: null,
    seed: 'match-321',
    quality: 'Medium',
    development: true,
    simulateWebGlFailure: false,
    simulatePlayerAssetFailure: false,
    playerVisual: 'Auto'
};

const teams = createFuturebolTeamVisualConfiguration(options);
assert.equal(teams.home.symbol, 'SOL');
assert.equal(teams.home.logoUrl, 'https://resolved.test/sol');
assert.equal(teams.away.symbol, 'XEC');
assert.equal(teams.away.logoUrl, 'https://resolved.test/xec');

const apiSource = createFuturebolMarketSource(options);
assert.ok(apiSource instanceof ApiMarketSource);
let emissions = 0;
apiSource.subscribe(received => {
    emissions += 1;
    assert.equal(received.home.symbol, 'SOL');
    assert.equal(received.away.symbol, 'XEC');
});
await apiSource.connect();
apiSource.push({ ...snapshot, sequence: 8 });
assert.equal(emissions, 2);
apiSource.reportError('temporary');
assert.equal(apiSource.getDiagnostics().error, 'temporary');
await apiSource.disconnect();
apiSource.push({ ...snapshot, sequence: 9 });
assert.equal(emissions, 2, 'disconnect must remove the API subscription');

const mockSource = createFuturebolMarketSource({ ...options, dataMode: 'mock' });
assert.ok(mockSource instanceof MockMarketSource);
await mockSource.disconnect();

class FakeDynamicTexture {
    static instances = [];
    constructor(name) {
        this.name = name;
        this.draws = [];
        this.images = [];
        this.disposals = 0;
        this.context = {
            clearRect: () => undefined,
            drawImage: (...args) => this.images.push(args)
        };
        FakeDynamicTexture.instances.push(this);
    }
    getContext() { return this.context; }
    update() { this.updated = true; }
    drawText(...args) { this.draws.push(args); }
    dispose() { this.disposals += 1; }
}
class FakeMaterial {
    constructor(name) { this.name = name; this.disposals = 0; }
    dispose() { this.disposals += 1; }
}
class FakeColor3 {
    constructor(r, g, b) { this.r = r; this.g = g; this.b = b; }
}
const fakeBabylon = {
    DynamicTexture: FakeDynamicTexture,
    StandardMaterial: FakeMaterial,
    Color3: FakeColor3
};
const failedLogoUrls = new Set(['https://resolved.test/sol']);
const fetchedLogoUrls = [];
globalThis.fetch = async url => {
    fetchedLogoUrls.push(url);
    if (failedLogoUrls.has(url))
        return { ok: false, status: 404, blob: async () => ({ size: 0 }) };
    return { ok: true, status: 200, blob: async () => ({ size: 128 }) };
};
globalThis.createImageBitmap = async () => ({
    width: 192,
    height: 128,
    close() { this.closed = true; }
});
const logos = new FuturebolTeamLogoTextureProvider(fakeBabylon, {}, teams, true);
await logos.ready();
assert.equal(logos.material('home'), logos.material('home'), 'one team material is shared by every player');
assert.equal(fetchedLogoUrls.length, 2);
assert.equal(logos.material('home').diffuseTexture, logos.material('home').opacityTexture);
assert.equal(logos.material('home').diffuseTexture, logos.material('home').emissiveTexture);
assert.equal(logos.diagnostics().away.loaded, true, 'successful image load must remain the primary visual');
const awayLogoTexture = FakeDynamicTexture.instances.find(texture => texture.images.length > 0);
assert.equal(awayLogoTexture.images[0][3], 448, 'wide logos must be fitted without stretching');
assert.ok(awayLogoTexture.images[0][4] < 448, 'the original logo aspect ratio must be preserved');
const logoDiagnostic = logos.diagnostics();
assert.equal(logoDiagnostic.home.loaded, false);
assert.equal(logoDiagnostic.home.fallbackActive, true);
assert.equal(logoDiagnostic.home.symbol, 'SOL');
const homeFallback = FakeDynamicTexture.instances.find(texture => texture.draws.length > 0);
assert.equal(homeFallback.draws[0][0], 'SOL', 'fallback must use the real symbol');
const sharedHomeMaterial = logos.material('home');
for (const [homeSymbol, awaySymbol] of [['BMT', 'TUT'], ['BTC', 'ETH'], ['SOL', 'XRP'], ['BMT', 'TUT']]) {
    failedLogoUrls.clear();
    await logos.reconfigure({
        home: { symbol: homeSymbol, logoUrl: `https://resolved.test/${homeSymbol.toLowerCase()}` },
        away: { symbol: awaySymbol, logoUrl: `https://resolved.test/${awaySymbol.toLowerCase()}` }
    });
    assert.equal(logos.material('home'), sharedHomeMaterial, 'match changes must preserve materials and player instances');
    assert.equal(logos.diagnostics().home.symbol, homeSymbol);
    assert.equal(logos.diagnostics().away.symbol, awaySymbol);
}
assert.equal(fetchedLogoUrls.length, 10, 'each match change reloads only team logos, never the humanoid GLB');
logos.dispose();
logos.dispose();
assert.equal(homeFallback.disposals, 1, 'fallback texture disposal must be idempotent');

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const primitiveSource = readFileSync(`${sourceRoot}/player/futurebol-primitive-player-visual.ts`, 'utf8');
const skeletalSource = readFileSync(`${sourceRoot}/player/futurebol-skeletal-player-visual.ts`, 'utf8');
const factorySource = readFileSync(`${sourceRoot}/player/futurebol-player-visual-factory.ts`, 'utf8');
const allTypeScript = [
    primitiveSource,
    skeletalSource,
    factorySource,
    readFileSync(`${sourceRoot}/futurebol-team-configuration.ts`, 'utf8')
].join('\n');

assert.equal(allTypeScript.includes('/api/icons/'), false, 'TypeScript must not construct the icon API route');
assert.equal(allTypeScript.includes('api.criptoversus.com'), false, 'TypeScript must not hardcode an API host');
assert.equal(primitiveSource.includes('₿') || primitiveSource.includes('Ξ'), false);
assert.equal(skeletalSource.includes('₿') || skeletalSource.includes('Ξ'), false);
assert.ok(primitiveSource.includes('teamVisual: FuturebolTeamVisualConfiguration'));
assert.ok(skeletalSource.includes('teamVisual: FuturebolTeamVisualConfiguration'));
assert.equal((factorySource.match(/this\.teams\[player\.team\]/g) ?? []).length, 2);
assert.ok(primitiveSource.includes('logoMaterial'));
assert.ok(skeletalSource.includes('logoMaterial'));
assert.equal((primitiveSource.match(/\$\{player\.id\}-coin-head/g) ?? []).length, 1);
assert.equal((skeletalSource.match(/\$\{this\.player\.id\}-coin-head/g) ?? []).length, 1);
assert.equal((primitiveSource.match(/coin-logo-(?:front|back)/g) ?? []).length, 2);
assert.equal((skeletalSource.match(/coin-logo-(?:front|back)/g) ?? []).length, 2);
assert.equal(skeletalSource.includes('chest-logo-front'), false);
assert.ok(skeletalSource.includes('CreateCylinder'), 'skeletal deve preservar a cabeça-moeda anterior');
assert.equal(primitiveSource.includes('CreateDisc'), false);
assert.equal(skeletalSource.includes('CreateDisc'), false);

console.log('Futurebol vertical integration tests passed.');
