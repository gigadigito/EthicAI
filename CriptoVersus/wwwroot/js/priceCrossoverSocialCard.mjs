/**
 * Price Crossover Social Card — renderer Canvas + contrato de prontidao para Browserless.
 *
 * IMPORTANTE:
 * - Este modulo NAO calcula cruzamentos. Os marcadores vem posicionados em
 *   `series.markers`, ja resolvidos por BLL.NFTFutebol.PriceCrossoverAnalyzer na API.
 *   Colocar um marcador aqui e apenas uma operacao de desenho.
 * - Os pontos de `series.points` ja vem normalizados pelo baseline FIXO da API.
 *   Este modulo nao renormaliza.
 * - A coordenada X e TEMPORAL (eixo de tempo real), nao por indice de array.
 *   Isso corrige a divergencia de pareamento por indice da tela de Match.
 * - O dominio do eixo temporal cobre a janela OFICIAL da partida quando
 *   `options.matchStartUnixSeconds`/`matchEndUnixSeconds` sao informados, garantindo que o
 *   primeiro e o ultimo timestamp fiquem visiveis. Nenhum ponto e inventado ou interpolado.
 * - Identidade visual preservada do TvMatchPriceBattleChart: fundo #030a13,
 *   grade rgba(112,146,172,.12), ativo A em lima (#B8FF00), ativo B em ciano (#00D5DF).
 *
 * Nada aqui e recalculado para efeito de placar, vencedor ou pontuacao oficial.
 */

const BACKGROUND = "#030a13";
const TEXT_COLOR = "rgba(232, 239, 249, 0.86)";
const TEXT_SOFT = "rgba(174, 189, 205, 0.78)";
const GRID_COLOR = "rgba(112, 146, 172, 0.12)";
const AXIS_COLOR = "rgba(112, 146, 172, 0.22)";
const BASELINE_COLOR = "rgba(214, 226, 240, 0.62)";

const DEFAULT_LEFT_COLOR = "#B8FF00";
const DEFAULT_RIGHT_COLOR = "#00D5DF";

const MARGIN = { left: 64, right: 34, top: 38, bottom: 48 };

// Breaks the drawn line across a real data gap instead of inventing a smooth bridge.
const GAP_BREAK_FACTOR = 3;

const MAX_DEVICE_PIXEL_RATIO = 2;
const TIME_TICK_INTERVALS = 6;

const mounted = new Map();

/**
 * Renderiza o grafico e resolve quando a pintura + fontes + imagens estao estaveis.
 *
 * @param {{
 *   canvas?: HTMLCanvasElement,
 *   canvasId?: string,
 *   markerLayerId?: string,
 *   series: { points: Array, markers: Array, minNormalizedValue: number, maxNormalizedValue: number },
 *   options?: {
 *     leftColor?: string, rightColor?: string, leftLabel?: string, rightLabel?: string,
 *     locale?: string, valueDecimals?: number, baselineNote?: string,
 *     matchStartUnixSeconds?: number|null, matchEndUnixSeconds?: number|null
 *   }
 * }} payload
 * @returns {Promise<{ ok: boolean, pointCount: number, markerCount: number }>}
 */
export async function renderPriceCrossoverSocialCard(payload) {
    const canvas = resolveElement(payload?.canvas, payload?.canvasId);
    if (!canvas || typeof canvas.getContext !== "function") {
        return { ok: false, pointCount: 0, markerCount: 0 };
    }

    const options = payload.options ?? {};
    const points = Array.isArray(payload.series?.points) ? payload.series.points : [];
    const markers = Array.isArray(payload.series?.markers) ? payload.series.markers : [];

    await waitForFonts();

    const size = paint(canvas, points, markers, options);

    // Apos desenhar, aguardar o ciclo de pintura do navegador antes de sinalizar prontidao.
    await nextPaint();
    await nextPaint();

    return { ok: size.ok, pointCount: points.length, markerCount: markers.length };
}

function resolveElement(elementOrId, id) {
    if (elementOrId && typeof elementOrId.getContext === "function") {
        return elementOrId;
    }

    const targetId = typeof elementOrId === "string" ? elementOrId : id;
    if (!targetId || typeof document === "undefined") {
        return null;
    }

    return document.getElementById(targetId);
}

/**
 * Procura textos de traducao NAO resolvidos (chaves literais) dentro do card.
 * Nenhuma chave `social.priceCrossover.*` pode chegar a imagem final.
 *
 * @param {HTMLElement|string} rootOrId
 * @returns {string[]} chaves encontradas (vazio = i18n ok)
 */
export function detectUnresolvedLocalizationKeys(rootOrId) {
    const root = resolveElement(rootOrId, rootOrId);
    if (!root || typeof document === "undefined") {
        return [];
    }

    const pattern = /(social\.)?priceCrossover\.[A-Za-z0-9_.]+/gi;
    const found = new Set();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const text = node.nodeValue ?? "";
        for (const match of text.matchAll(pattern)) {
            found.add(match[0]);
        }
        node = walker.nextNode();
    }

    return [...found];
}

/**
 * Sincroniza os atributos de prontidao do elemento raiz.
 * A prontidao e uma CONJUNCAO de condicoes resolvidas em C# e em JS.
 * Nunca e resolvida por timeout fixo.
 *
 * @param {HTMLElement|string} rootOrId
 * @param {{ renderComplete?: boolean, fontsReady?: boolean, imagesReady?: boolean }} flags
 */
export function syncPriceCrossoverSocialReadiness(rootOrId, flags) {
    const root = resolveElement(rootOrId, rootOrId);
    if (!root) {
        return false;
    }

    if (flags?.renderComplete !== undefined) {
        root.setAttribute("data-render-complete", flags.renderComplete ? "true" : "false");
    }
    if (flags?.fontsReady !== undefined) {
        root.setAttribute("data-fonts-ready", flags.fontsReady ? "true" : "false");
    }
    if (flags?.imagesReady !== undefined) {
        root.setAttribute("data-images-ready", flags.imagesReady ? "true" : "false");
    }

    const unresolvedKeys = detectUnresolvedLocalizationKeys(root);
    root.setAttribute("data-i18n-ok", unresolvedKeys.length === 0 ? "true" : "false");
    if (unresolvedKeys.length > 0) {
        root.setAttribute("data-i18n-unresolved", unresolvedKeys.join(","));
    } else {
        root.removeAttribute("data-i18n-unresolved");
    }

    const csReady = root.getAttribute("data-cs-ready") === "true";
    const renderComplete = root.getAttribute("data-render-complete") === "true";
    const fontsReady = root.getAttribute("data-fonts-ready") === "true";
    const imagesReady = root.getAttribute("data-images-ready") === "true";
    const localizationOk = root.getAttribute("data-i18n-ok") === "true";
    const captureState = root.getAttribute("data-capture-state") || "";

    const ready = csReady
        && renderComplete
        && fontsReady
        && imagesReady
        && localizationOk
        && captureState === "ready";

    if (ready) {
        root.setAttribute("data-social-ready", "true");
    } else {
        root.removeAttribute("data-social-ready");
    }

    return ready;
}

/**
 * Aguarda todas as imagens do elemento entrarem em estado terminal (loaded ou erro/fallback).
 * Imagens que falham nao bloqueiam: o fallback visual ja esta previsto no markup.
 */
export function waitForImages(rootOrId, timeoutMs = 4000) {
    const root = resolveElement(rootOrId, rootOrId);
    const images = root
        ? Array.from(root.querySelectorAll("img"))
        : [];

    if (images.length === 0) {
        return Promise.resolve(true);
    }

    const waiters = images.map((img) => {
        if (img.complete) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(true);
            };

            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
        });
    });

    return Promise.race([
        Promise.all(waiters).then(() => true),
        delay(timeoutMs).then(() => true)
    ]);
}

export function waitForFonts(timeoutMs = 3000) {
    if (typeof document === "undefined" || !document.fonts || !document.fonts.ready) {
        return Promise.resolve(true);
    }

    return Promise.race([
        document.fonts.ready.then(() => true),
        delay(timeoutMs).then(() => true)
    ]);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextPaint() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame !== "function") {
            setTimeout(resolve, 0);
            return;
        }

        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    });
}

function paint(canvas, points, markers, options) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 0));
    const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 0));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return { ok: false };
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const leftColor = options.leftColor || DEFAULT_LEFT_COLOR;
    const rightColor = options.rightColor || DEFAULT_RIGHT_COLOR;
    const locale = options.locale || "en-US";
    const valueDecimals = Number.isInteger(options.valueDecimals) ? options.valueDecimals : 3;
    const baselineNote = options.baselineNote || "baseline";

    if (points.length < 2) {
        drawEmptyFrame(ctx, width, height);
        return { ok: false };
    }

    const minRaw = Number(options.minNormalizedValue);
    const maxRaw = Number(options.maxNormalizedValue);
    const hasRange = Number.isFinite(minRaw) && Number.isFinite(maxRaw) && maxRaw > minRaw;

    const values = [];
    for (const point of points) {
        const a = Number(point.normalizedValueA);
        const b = Number(point.normalizedValueB);
        if (Number.isFinite(a)) values.push(a);
        if (Number.isFinite(b)) values.push(b);
    }

    const minValue = hasRange ? minRaw : Math.min(...values);
    const maxValue = hasRange ? maxRaw : Math.max(...values);
    const span = maxValue - minValue;
    const padding = Math.max(span * 0.14, 0.01);

    const yMin = minValue - padding;
    const yMax = maxValue + padding;

    // Dominio temporal: janela oficial da partida quando disponivel, sempre cobrindo os dados.
    const dataT0 = Number(points[0].timeUnixSeconds);
    const dataT1 = Number(points[points.length - 1].timeUnixSeconds);
    const matchStart = Number(options.matchStartUnixSeconds);
    const matchEnd = Number(options.matchEndUnixSeconds);

    let t0 = Number.isFinite(matchStart) ? Math.min(matchStart, dataT0) : dataT0;
    let t1 = Number.isFinite(matchEnd) ? Math.max(matchEnd, dataT1) : dataT1;
    if (!(t1 > t0)) {
        t0 = dataT0;
        t1 = dataT1 > dataT0 ? dataT1 : dataT0 + 1;
    }

    const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
    const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);

    const xFor = (t) => MARGIN.left + ((Number(t) - t0) / (t1 - t0)) * plotWidth;
    const yFor = (v) => MARGIN.top + ((yMax - Number(v)) / (yMax - yMin)) * plotHeight;

    drawGrid(ctx, width, height, plotWidth, plotHeight, yMin, yMax, t0, t1, xFor, locale, valueDecimals);

    // Asset A (lima) e Asset B (ciano): duas curvas independentes, mesmo eixo temporal.
    drawSeries(ctx, points, xFor, yFor, "normalizedValueB", rightColor, 0.10, 3.0);
    drawSeries(ctx, points, xFor, yFor, "normalizedValueA", leftColor, 0.13, 3.4);

    // Linha de base 1,0 desenhada POR CIMA das series: mantem a referencia visivel mesmo
    // quando uma serie quase constante coincide com ela.
    drawBaseline(ctx, width, yFor, locale, valueDecimals, baselineNote);

    drawEndDot(ctx, points[points.length - 1], "normalizedValueA", xFor, yFor, leftColor);
    drawEndDot(ctx, points[points.length - 1], "normalizedValueB", xFor, yFor, rightColor);

    drawMarkers(ctx, markers, xFor, yFor, leftColor, rightColor);

    drawLegend(ctx, width, options, leftColor, rightColor);

    canvas.dataset.axisStart = formatClock(t0);
    canvas.dataset.axisEnd = formatClock(t1);
    canvas.dataset.valueMin = formatValue(yMin, locale, valueDecimals);
    canvas.dataset.valueMax = formatValue(yMax, locale, valueDecimals);

    return { ok: true };
}

function drawEmptyFrame(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
        const y = MARGIN.top + ((height - MARGIN.top - MARGIN.bottom) / 4) * i;
        ctx.beginPath();
        ctx.moveTo(MARGIN.left, y);
        ctx.lineTo(width - MARGIN.right, y);
        ctx.stroke();
    }
    ctx.restore();
}

function drawGrid(ctx, width, height, plotWidth, plotHeight, yMin, yMax, t0, t1, xFor, locale, valueDecimals) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = "600 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";

    // Escala relativa (normalizada).
    ctx.textAlign = "right";
    ctx.fillStyle = TEXT_SOFT;
    for (let i = 0; i <= 4; i += 1) {
        const y = MARGIN.top + (plotHeight / 4) * i;
        ctx.strokeStyle = GRID_COLOR;
        ctx.beginPath();
        ctx.moveTo(MARGIN.left, y);
        ctx.lineTo(width - MARGIN.right, y);
        ctx.stroke();

        const value = yMax - ((yMax - yMin) / 4) * i;
        ctx.fillText(formatValue(value, locale, valueDecimals), MARGIN.left - 12, y);
    }

    // Escala temporal: cobre a janela inteira; primeiro e ultimo rotulo alinhados para dentro,
    // para nunca sairem da area visivel.
    const tickCount = TIME_TICK_INTERVALS;
    for (let i = 0; i <= tickCount; i += 1) {
        const t = t0 + ((t1 - t0) / tickCount) * i;
        const x = xFor(t);

        ctx.strokeStyle = AXIS_COLOR;
        ctx.beginPath();
        ctx.moveTo(x, MARGIN.top);
        ctx.lineTo(x, height - MARGIN.bottom);
        ctx.stroke();

        ctx.fillStyle = TEXT_SOFT;
        if (i === 0) {
            ctx.textAlign = "left";
            ctx.fillText(formatClock(t), x - 4, height - MARGIN.bottom + 22);
        } else if (i === tickCount) {
            ctx.textAlign = "right";
            ctx.fillText(formatClock(t), x + 4, height - MARGIN.bottom + 22);
        } else {
            ctx.textAlign = "center";
            ctx.fillText(formatClock(t), x, height - MARGIN.bottom + 22);
        }
    }

    ctx.restore();
}

/**
 * Linha de referencia do valor inicial normalizado (1,0), distinta dos dados reais.
 */
function drawBaseline(ctx, width, yFor, locale, valueDecimals, baselineNote) {
    const y = yFor(1);
    ctx.save();
    ctx.setLineDash([9, 7]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = BASELINE_COLOR;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, y);
    ctx.lineTo(width - MARGIN.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = BASELINE_COLOR;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${baselineNote} ${formatValue(1, locale, valueDecimals)}`, width - MARGIN.right - 4, y - 5);
    ctx.restore();
}

function drawSeries(ctx, points, xFor, yFor, valueKey, color, fillAlpha, lineWidth) {
    const segments = splitOnGaps(points);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Halo: mantem a serie identificavel mesmo quando quase constante sobre a linha de base.
    ctx.lineWidth = lineWidth + 5;
    ctx.strokeStyle = hexToRgba(color, 0.16);
    for (const segment of segments) {
        strokeSegment(ctx, segment, xFor, yFor, valueKey);
    }

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;

    for (const segment of segments) {
        strokeSegment(ctx, segment, xFor, yFor, valueKey);
    }

    ctx.shadowBlur = 0;

    const primary = segments[0] ?? [];
    if (primary.length >= 2) {
        const floorValue = minYFor(primary, valueKey);

        ctx.beginPath();
        ctx.moveTo(xFor(primary[0].timeUnixSeconds), yFor(primary[0][valueKey]));
        for (let i = 1; i < primary.length; i += 1) {
            ctx.lineTo(xFor(primary[i].timeUnixSeconds), yFor(primary[i][valueKey]));
        }
        ctx.lineTo(xFor(primary[primary.length - 1].timeUnixSeconds), yFor(floorValue));
        ctx.lineTo(xFor(primary[0].timeUnixSeconds), yFor(floorValue));
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
        gradient.addColorStop(0, hexToRgba(color, fillAlpha));
        gradient.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    ctx.restore();
}

function strokeSegment(ctx, segment, xFor, yFor, valueKey) {
    if (segment.length < 2) {
        return;
    }

    ctx.beginPath();
    ctx.moveTo(xFor(segment[0].timeUnixSeconds), yFor(segment[0][valueKey]));
    for (let i = 1; i < segment.length; i += 1) {
        ctx.lineTo(xFor(segment[i].timeUnixSeconds), yFor(segment[i][valueKey]));
    }
    ctx.stroke();
}

function minYFor(segment, valueKey) {
    let min = Number.POSITIVE_INFINITY;
    for (const point of segment) {
        const value = Number(point[valueKey]);
        if (Number.isFinite(value) && value < min) {
            min = value;
        }
    }
    return Number.isFinite(min) ? min : 0;
}

/**
 * Quebra a linha em buracos reais de dados. Nao interpola: um salto temporal
 * muito acima da cadencia mediana e tratado como ausencia de observacao.
 */
function splitOnGaps(points) {
    if (points.length === 0) {
        return [];
    }

    const intervals = [];
    for (let i = 1; i < points.length; i += 1) {
        const delta = Number(points[i].timeUnixSeconds) - Number(points[i - 1].timeUnixSeconds);
        if (delta > 0) {
            intervals.push(delta);
        }
    }

    intervals.sort((a, b) => a - b);
    const median = intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 0;
    const threshold = Math.max(median * GAP_BREAK_FACTOR, 1);

    const segments = [];
    let current = [points[0]];

    for (let i = 1; i < points.length; i += 1) {
        const delta = Number(points[i].timeUnixSeconds) - Number(points[i - 1].timeUnixSeconds);
        if (delta > threshold) {
            segments.push(current);
            current = [];
        }
        current.push(points[i]);
    }

    segments.push(current);
    return segments;
}

function drawEndDot(ctx, point, valueKey, xFor, yFor, color) {
    const value = Number(point[valueKey]);
    if (!Number.isFinite(value)) {
        return;
    }

    const x = xFor(point.timeUnixSeconds);
    const y = yFor(value);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = BACKGROUND;
    ctx.stroke();
    ctx.restore();
}

/**
 * Marcadores de cruzamento. A POSICAO vem da API. Este trecho nao detecta
 * nenhum cruzamento: apenas desenha no (timestamp, valor) informado.
 *
 * Cruzamentos RELEVANTES recebem linha vertical tracejada + anel de destaque.
 * Cruzamentos apenas matematicos viram um ponto pequeno, sem linhas que sugiram
 * grandes eventos. A cor segue a DIRECAO reportada pela API:
 * "up" = ativo A ultrapassou B; "down" = ativo B ultrapassou A.
 */
function drawMarkers(ctx, markers, xFor, yFor, leftColor, rightColor) {
    if (!Array.isArray(markers) || markers.length === 0) {
        return;
    }

    ctx.save();

    for (const marker of markers) {
        const value = Number(marker.normalizedValue);
        if (!Number.isFinite(value)) {
            continue;
        }

        const x = xFor(marker.timeUnixSeconds);
        const y = yFor(value);
        const color = marker.direction === "down" ? rightColor : leftColor;

        if (marker.isRelevant) {
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = hexToRgba(color, 0.62);
            ctx.beginPath();
            ctx.moveTo(x, MARGIN.top);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = BACKGROUND;
            ctx.fill();
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = color;
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(x, y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = BACKGROUND;
            ctx.stroke();
        }
    }

    ctx.restore();
}

function drawLegend(ctx, width, options, leftColor, rightColor) {
    const leftLabel = options.leftLabel || "ASSET A";
    const rightLabel = options.rightLabel || "ASSET B";

    ctx.save();
    ctx.font = "700 14px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";

    const y = MARGIN.top - 18;

    ctx.textAlign = "left";
    ctx.fillStyle = leftColor;
    ctx.fillRect(MARGIN.left, y - 3, 18, 3);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(leftLabel, MARGIN.left + 26, y - 1);

    ctx.textAlign = "right";
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(rightLabel, width - MARGIN.right - 26, y - 1);
    ctx.fillStyle = rightColor;
    ctx.fillRect(width - MARGIN.right - 18, y - 3, 18, 3);

    ctx.restore();
}

function formatValue(value, locale, decimals) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return "--";
    }

    try {
        return number.toLocaleString(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    } catch {
        return number.toFixed(decimals);
    }
}

function formatClock(unixSeconds) {
    const date = new Date(Number(unixSeconds) * 1000);
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function hexToRgba(hex, alpha) {
    const normalized = String(hex || "").replace("#", "");
    const full = normalized.length === 3
        ? normalized.split("").map((c) => c + c).join("")
        : normalized;

    const value = Number.parseInt(full, 16);
    if (!Number.isFinite(value)) {
        return `rgba(255,255,255,${alpha})`;
    }

    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

// Mantido para compatibilidade de dispose em navegacoes repetidas.
export function disposePriceCrossoverSocialCard(key) {
    mounted.delete(key);
}
