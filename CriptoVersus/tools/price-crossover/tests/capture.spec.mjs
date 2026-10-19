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
