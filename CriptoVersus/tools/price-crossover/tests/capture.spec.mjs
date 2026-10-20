// Captura real da imagem social do Price Crossover (pipeline Browserless-equivalent:
// viewport = dimensao da imagem, card = imagem inteira).
//
// Validacoes: geometria (dimensoes, bounds, sem scroll), internacionalizacao
// (nenhuma chave literal), dados oficiais da partida 41212 e janela temporal completa.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const capturesDir = resolve(here, '../../../../tmp/price-crossover-social-captures');

// Seletor composto aguardado pelo node Browserless do workflow n8n (captura social).
const BROWSERLESS_READY_SELECTOR =
    '.tv-price-battle[data-social-ready="true"][data-match-status="finished"][data-data-complete="true"][data-render-complete="true"]';

// Contrato canonico documentado no README do workflow (mesmo alvo, sem o alias de classe).
const CANONICAL_READY_SELECTOR = '#price-crossover-social-card[data-social-ready="true"]';

test.beforeAll(() => {
    mkdirSync(capturesDir, { recursive: true });
});

async function collectGeometry(page) {
    return page.evaluate(() => {
        const card = document.getElementById('price-crossover-social-card');
        const cardRect = card.getBoundingClientRect();
        const offenders = [];

        for (const element of card.querySelectorAll('*')) {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                continue;
            }

            const overflowRight = rect.right - cardRect.right;
            const overflowLeft = cardRect.left - rect.left;
            const overflowBottom = rect.bottom - cardRect.bottom;
            const overflowTop = cardRect.top - rect.top;
            const worst = Math.max(overflowRight, overflowLeft, overflowBottom, overflowTop);

            if (worst > 0.5) {
                offenders.push({
                    tag: element.tagName.toLowerCase(),
                    className: element.className?.toString?.() ?? '',
                    text: (element.textContent ?? '').trim().slice(0, 60),
                    overflowRight: Math.round(overflowRight * 10) / 10,
                    overflowLeft: Math.round(overflowLeft * 10) / 10,
                    overflowBottom: Math.round(overflowBottom * 10) / 10,
                    overflowTop: Math.round(overflowTop * 10) / 10
                });
            }
        }

        return {
            card: {
                width: cardRect.width,
                height: cardRect.height,
                left: cardRect.left,
                top: cardRect.top
            },
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight,
                clientWidth: document.documentElement.clientWidth,
                clientHeight: document.documentElement.clientHeight,
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight
            },
            chart: (() => {
                const canvas = document.getElementById('price-crossover-social-canvas');
                const rect = canvas.getBoundingClientRect();
                return {
                    height: rect.height,
                    width: rect.width,
                    axisStart: canvas.dataset.axisStart ?? null,
                    axisEnd: canvas.dataset.axisEnd ?? null
                };
            })(),
            flags: {
                captureState: card.getAttribute('data-capture-state'),
                renderComplete: card.getAttribute('data-render-complete'),
                i18nOk: card.getAttribute('data-i18n-ok'),
                socialReady: card.getAttribute('data-social-ready'),
                dataComplete: card.getAttribute('data-data-complete'),
                matchStatus: card.getAttribute('data-match-status'),
                apiStatus: card.getAttribute('data-api-status'),
                unresolved: card.getAttribute('data-i18n-unresolved')
            },
            text: card.innerText,
            sourceText: card.textContent,
            offenders
        };
    });
}

function assertNoOverflow(geometry) {
    expect(geometry.offenders, `elementos fora do card: ${JSON.stringify(geometry.offenders, null, 2)}`).toEqual([]);
}

function assertNoScroll(geometry) {
    expect(geometry.document.scrollWidth).toBeLessThanOrEqual(geometry.document.clientWidth);
    expect(geometry.document.scrollHeight).toBeLessThanOrEqual(geometry.document.clientHeight);
}

function assertNoUnresolvedKeys(geometry) {
    expect(geometry.text).not.toMatch(/priceCrossover\./i);
    expect(geometry.sourceText).not.toMatch(/priceCrossover\./i);
    expect(geometry.text).not.toMatch(/SOCIAL\.PRICECROSSOVER/i);
    expect(geometry.flags.i18nOk).toBe('true');
    expect(geometry.flags.unresolved).toBeNull();
}

// text-transform: uppercase afeta innerText; as comparacoes de texto sao case-insensitive.
function expectVisibleText(geometry, needle) {
    expect(
        geometry.text.toLowerCase().includes(needle.toLowerCase())
        || geometry.sourceText.toLowerCase().includes(needle.toLowerCase()),
        `texto ausente: "${needle}"`
    ).toBe(true);
}

function expectNoVisibleText(geometry, needle) {
    expect(geometry.text.toLowerCase().includes(needle.toLowerCase())).toBe(false);
    expect(geometry.sourceText.toLowerCase().includes(needle.toLowerCase())).toBe(false);
}

async function openCapture(page, url, viewport) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await page.waitForFunction(() => {
        const card = document.getElementById('price-crossover-social-card');
        return card && (card.getAttribute('data-render-complete') === 'true' || card.getAttribute('data-capture-state') === 'error');
    }, null, { timeout: 30000 });
}

test('4x3 pt-BR partida 41212: dimensoes 1200x900, sem corte, i18n resolvido e janela completa', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-4x3-base.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    expect(geometry.card.width).toBeCloseTo(1200, 0);
    expect(geometry.card.height).toBeCloseTo(900, 0);
    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);

    // Grafico e o elemento principal: ~50% da altura da imagem.
    expect(geometry.chart.height).toBeGreaterThanOrEqual(430);
    expect(geometry.chart.height).toBeLessThanOrEqual(470);

    // Janela temporal completa da partida (17:13:06 - 18:43:40 UTC).
    expect(geometry.chart.axisStart).toBe('17:13');
    expect(geometry.chart.axisEnd).toBe('18:43');

    // Dados oficiais da partida 41212.
    expectVisibleText(geometry, '3 - 4');
    expectVisibleText(geometry, '-1,37%');
    expectVisibleText(geometry, '+0,04%');
    expectVisibleText(geometry, '1,41');
    expectVisibleText(geometry, 'Cruzamentos detectados');
    expectVisibleText(geometry, 'Ultrapassagens relevantes');
    expectVisibleText(geometry, 'XAUT');
    expectVisibleText(geometry, 'PROM');
    expectVisibleText(geometry, 'Batalha de Preços');
    expectVisibleText(geometry, 'criptoversus.com');

    expect(geometry.flags.captureState).toBe('ready');
    expect(geometry.flags.renderComplete).toBe('true');
    expect(geometry.flags.socialReady).toBe('true');
    expect(geometry.flags.dataComplete).toBe('true');
    expect(geometry.flags.matchStatus).toBe('finished');
    expect(geometry.flags.apiStatus).toBe('Completed');

    await page.screenshot({ path: resolve(capturesDir, '41212-pt-BR-1200x900.png') });
});

test('16x9 pt-BR partida 41212: preset 1200x675 sem distorcer a composicao', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-16x9-base.html', { width: 1200, height: 675 });
    const geometry = await collectGeometry(page);

    expect(geometry.card.width).toBeCloseTo(1200, 0);
    expect(geometry.card.height).toBeCloseTo(675, 0);
    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);

    expect(geometry.chart.height).toBeGreaterThanOrEqual(270);
    expect(geometry.chart.axisStart).toBe('17:13');
    expect(geometry.chart.axisEnd).toBe('18:43');
    expectVisibleText(geometry, '3 - 4');

    await page.screenshot({ path: resolve(capturesDir, '41212-pt-BR-1200x675.png') });
});

test('en-US partida 41212: traducao completa em outro idioma, sem chaves', async ({ page }) => {
    await openCapture(page, '/capture-en-US-4x3-base.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);
    expectVisibleText(geometry, 'Final score');
    expectVisibleText(geometry, 'Detected crossovers');
    expectVisibleText(geometry, '-1.37%');

    await page.screenshot({ path: resolve(capturesDir, '41212-en-US-1200x900.png') });
});

test('fr-FR partida 41212: textos longos continuam dentro dos limites', async ({ page }) => {
    await openCapture(page, '/capture-fr-FR-4x3-base.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);
    expectVisibleText(geometry, 'Croisements détectés');

    await page.screenshot({ path: resolve(capturesDir, '41212-fr-FR-1200x900.png') });
});

test('regressao: simbolos longos nao ultrapassam o card', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-4x3-long-symbols.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);
    expectVisibleText(geometry, '1000PEPE');
});

test('regressao: muitos cruzamentos preservam limites e distinguem relevantes', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-4x3-many-crossovers.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);
    expectVisibleText(geometry, 'Cruzamentos detectados');
});

test('regressao: metricas ausentes nao inventam dados nem quebram o layout', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-4x3-missing-metrics.html', { width: 1200, height: 900 });
    const geometry = await collectGeometry(page);

    assertNoOverflow(geometry);
    assertNoScroll(geometry);
    assertNoUnresolvedKeys(geometry);
    expectNoVisibleText(geometry, 'Diferença de desempenho');
    expectVisibleText(geometry, 'Pontos no gráfico');
});

function readPngSize(buffer) {
    // Assinatura PNG + IHDR: largura/altura em big-endian nos bytes 16..23.
    expect(buffer.subarray(0, 8).toString('hex'), 'assinatura PNG').toBe('89504e470d0a1a0a');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('Teste F - captura Browserless: seletor composto casa, canvas presente e PNG 1200x900 completo', async ({ page }) => {
    // Resolucao 1280x900: o card fixo de 1200x900 cabe inteiro, sem scroll nem corte.
    await openCapture(page, '/capture-pt-BR-4x3-base.html', { width: 1280, height: 900 });

    const target = page.locator(BROWSERLESS_READY_SELECTOR);
    await expect(target).toHaveCount(1);
    await expect(page.locator(CANONICAL_READY_SELECTOR)).toHaveCount(1);

    const captureTarget = target.first();
    await expect(captureTarget.locator('canvas#price-crossover-social-canvas')).toHaveCount(1);

    const geometry = await collectGeometry(page);
    assertNoOverflow(geometry);
    assertNoScroll(geometry);

    const image = await captureTarget.screenshot({
        path: resolve(capturesDir, '41212-browserless-1200x900.png')
    });
    const size = readPngSize(image);
    expect(size.width).toBeCloseTo(1200, 0);
    expect(size.height).toBeCloseTo(900, 0);

    // Imagem nao vazia: a composicao renderizada ocupa o PNG inteiro.
    expect(image.byteLength).toBeGreaterThan(30 * 1024);
});

test('captura Browserless: pagina nao pronta nunca casa o seletor de prontidao', async ({ page }) => {
    await openCapture(page, '/capture-pt-BR-4x3-not-publishable.html', { width: 1200, height: 900 });

    await expect(page.locator('#price-crossover-social-card[data-render-complete="true"]')).toHaveCount(1);
    await expect(page.locator(BROWSERLESS_READY_SELECTOR)).toHaveCount(0);
    await expect(page.locator(CANONICAL_READY_SELECTOR)).toHaveCount(0);

    const geometry = await collectGeometry(page);
    // Dados completos, mas partida em andamento e sem permissao de publicacao:
    // o contrato nunca declara a pagina pronta para captura.
    expect(geometry.flags.dataComplete).toBe('true');
    expect(geometry.flags.matchStatus).toBe('in_progress');
    expect(geometry.flags.apiStatus).toBe('Ongoing');
    expect(geometry.flags.socialReady).toBeNull();
});
