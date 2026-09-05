// Run after CandleBattleRenderingTests exports frozen HTML through CANDLE_PARITY_OUTPUT.
// PLAYWRIGHT_MODULE can point to the installed Playwright package; no live API is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.CANDLE_PARITY_OUTPUT || 'artifacts/candle-battle');
const root = path.resolve(import.meta.dirname, '../..');
const telemetry = fs.readFileSync(path.join(root, 'Components/Pages/Internet/TvStageTelemetryStack.razor'), 'utf8');
const css = telemetry.match(/<style>([\s\S]*?)<\/style>/)[1].replaceAll('@@', '@');
const partida = fs.readFileSync(path.join(output, 'partida-rendered.html'), 'utf8');
const tv = fs.readFileSync(path.join(output, 'tv-rendered.html'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
    await page.setContent(`<style>body{margin:0;background:#030a15;color:white;font-family:Arial} .fixture{width:1100px;height:600px;margin:20px} h2{margin:12px} ${css}</style>
        <h2>Partida — renderer compartilhado</h2><div id="partida" class="fixture">${partida}</div>
        <h2>TV — mesmo renderer, container maior</h2><div id="tv" class="fixture tv-stage-telemetry-stack--desktop" style="height:750px">${tv}</div>`);
    const read = () => page.evaluate(() => {
        return ['partida', 'tv'].map(id => {
            const host = document.getElementById(id);
            const svg = host.querySelector('svg');
            const top = 14, bottom = Number(host.querySelector('.tv-candle-battle__winner-baseline').getAttribute('y1'));
            return {
                viewBox: svg.getAttribute('viewBox'),
                candles: [...svg.querySelectorAll('g[data-ts]')].map(g => ({
                    time: g.dataset.ts,
                    bodies: [...g.querySelectorAll('.tv-candle-battle__body')].map(el => ({
                        side: el.classList.contains('tv-candle-battle__body--left') ? 'A' : 'B',
                        y: (el.getBBox().y - top) / (bottom - top),
                        height: el.getBBox().height / (bottom - top),
                        actualHeight: el.getBBox().height,
                        declaredHeight: Number(el.getAttribute('height'))
                    })),
                    dojis: [...g.querySelectorAll('.tv-candle-battle__doji')].map(el => el.outerHTML),
                    wicks: [...g.querySelectorAll('.tv-candle-battle__wick')].map(el => el.outerHTML),
                    marker: g.querySelector('.tv-candle-battle__winner-marker').outerHTML
                }))
            };
        });
    });
    const check = async () => {
        const [a, b] = await read();
        assert.deepEqual(a, b, 'Same financial SVG and effective geometry in Partida/TV');
        for (const candle of b.candles)
            for (const body of candle.bodies)
                assert.ok(Math.abs(body.actualHeight - body.declaredHeight) < 0.001, 'CSS must not override financial body height');
        return a;
    };
    const reference = await check();
    await page.screenshot({ path: path.join(output, 'comparison.png'), fullPage: true });
    // Mutation control: the removed rule must reproduce the real defect.
    const bad = await page.addStyleTag({ content: '.tv-stage-telemetry-stack--desktop :is(.tv-candle-battle, .tv-candle-battle__body){height:100%;min-height:0;max-height:none}' });
    const broken = await read();
    assert.notDeepEqual(broken[0], broken[1], 'Old TV CSS must break parity');
    await page.locator('#tv').screenshot({ path: path.join(output, 'tv-before.png') });
    await bad.evaluate(el => el.remove());
    for (const width of [390, 768, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('.fixture').evaluateAll((els, width) => els.forEach(el => {
            el.style.width = (width - 40) + 'px';
            el.style.height = '700px';
        }), width);
        await check();
        const scroll = await page.locator('#tv .tv-candle-battle-card__plot-shell').evaluate(el => {
            el.scrollLeft = -100;
            return { overflow: el.scrollWidth > el.clientWidth, moved: el.scrollLeft !== 0 };
        });
        if (width < 1000) assert.ok(scroll.overflow && scroll.moved, 'Horizontal scrollbar works');
        if (width === 390) await page.locator('#tv').screenshot({ path: path.join(output, 'mobile.png') });
    }
    fs.writeFileSync(path.join(output, 'browser-parity.json'), JSON.stringify(reference, null, 2));
    console.log(`PASS: ${reference.candles.length} frozen candle pairs, computed SVG heights, dojis, wicks, leader strip, 390/768/1920px resize, scrollbar; old CSS reproduces failure.`);
} finally {
    await browser.close();
}
