function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

const QUOTE_SUFFIXES = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "USD", "BTC", "ETH", "BRL"];

function cleanText(value, fallback = "") {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function compactSymbol(symbol) {
    return cleanText(symbol).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function splitTradingPair(symbol) {
    const normalized = compactSymbol(symbol);
    if (!normalized) {
        return { base: "ASSET", quote: "USD", pairLabel: "ASSET - USD" };
    }

    const matchedQuote = QUOTE_SUFFIXES.find((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
    if (!matchedQuote) {
        return { base: normalized, quote: "", pairLabel: normalized };
    }

    const base = normalized.slice(0, normalized.length - matchedQuote.length) || normalized;
    return {
        base,
        quote: matchedQuote,
        pairLabel: `${base} - ${matchedQuote}`
    };
}

function buildMeta(meta, fallbackAccent, side) {
    const parsed = splitTradingPair(meta?.symbol);
    return {
        side,
        symbol: cleanText(meta?.symbol, parsed.pairLabel),
        logoUrl: cleanText(meta?.logoUrl),
        accentColor: cleanText(meta?.accentColor, fallbackAccent),
        displayBase: parsed.base,
        displayPair: parsed.pairLabel
    };
}

function toPercentDelta(candle) {
    const open = Number(candle?.open);
    const close = Number(candle?.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || Math.abs(open) < 0.000001) {
        return 0;
    }

    return ((close - open) / Math.abs(open)) * 100;
}

function normalizeCandles(candles) {
    if (!Array.isArray(candles)) {
        return [];
    }

    return candles
        .filter((item) => Number.isFinite(Number(item?.time)))
        .map((item) => ({
            time: Number(item.time),
            open: Number(item.open),
            high: Number(item.high),
            low: Number(item.low),
            close: Number(item.close)
        }));
}

function alignBattleCandles(leftCandles, rightCandles) {
    const left = normalizeCandles(leftCandles);
    const right = normalizeCandles(rightCandles);
    if (left.length === 0 || right.length === 0) {
        return [];
    }

    const rightByTime = new Map(right.map((candle) => [candle.time, candle]));
    const aligned = [];

    left.forEach((leftCandle, index) => {
        const rightCandle = rightByTime.get(leftCandle.time) ?? right[index];
        if (!rightCandle || !Number.isFinite(rightCandle.time)) {
            return;
        }

        aligned.push({
            index,
            time: leftCandle.time,
            leftCandle,
            rightCandle
        });
    });

    return aligned;
}

function winnerForDeltas(leftDelta, rightDelta) {
    const difference = leftDelta - rightDelta;
    if (Math.abs(difference) <= 0.000001) {
        return "tie";
    }

    return difference > 0 ? "left" : "right";
}

function buildSamples(aligned) {
    return aligned.map((entry) => {
        const leftDelta = toPercentDelta(entry.leftCandle);
        const rightDelta = toPercentDelta(entry.rightCandle);
        return {
            index: entry.index,
            time: entry.time,
            leftCandle: entry.leftCandle,
            rightCandle: entry.rightCandle,
            leftDelta,
            rightDelta,
            winner: winnerForDeltas(leftDelta, rightDelta),
            margin: Math.abs(leftDelta - rightDelta)
        };
    });
}

function summarizeWins(samples) {
    return samples.reduce((accumulator, sample) => {
        accumulator.total += 1;
        if (sample.winner === "left") {
            accumulator.leftWins += 1;
        } else if (sample.winner === "right") {
            accumulator.rightWins += 1;
        } else {
            accumulator.ties += 1;
        }

        return accumulator;
    }, {
        total: 0,
        leftWins: 0,
        rightWins: 0,
        ties: 0
    });
}

function computeCurrentStreak(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return { winner: "tie", count: 0 };
    }

    const lastWinner = samples[samples.length - 1]?.winner ?? "tie";
    let count = 0;
    for (let index = samples.length - 1; index >= 0; index -= 1) {
        if (samples[index]?.winner !== lastWinner) {
            break;
        }

        count += 1;
    }

    return { winner: lastWinner, count };
}

function computeMomentum(samples, windowSize = 10) {
    const recent = samples.slice(-windowSize);
    if (recent.length === 0) {
        return { leftPercent: 50, rightPercent: 50, leftWins: 0, rightWins: 0, ties: 0, windowSize: 0, dominantSide: "tie" };
    }

    const summary = summarizeWins(recent);
    const decisive = summary.leftWins + summary.rightWins;
    if (decisive <= 0) {
        return { leftPercent: 50, rightPercent: 50, leftWins: summary.leftWins, rightWins: summary.rightWins, ties: summary.ties, windowSize: recent.length, dominantSide: "tie" };
    }

    const leftPercent = Math.round((summary.leftWins / decisive) * 100);
    const clampedLeft = clamp(leftPercent, 0, 100);
    const dominantSide = clampedLeft === 50 ? "tie" : clampedLeft > 50 ? "left" : "right";
    return {
        leftPercent: clampedLeft,
        rightPercent: 100 - clampedLeft,
        leftWins: summary.leftWins,
        rightWins: summary.rightWins,
        ties: summary.ties,
        windowSize: recent.length,
        dominantSide
    };
}

function buildLeader(summary) {
    if (summary.leftWins === summary.rightWins) {
        return "tie";
    }

    return summary.leftWins > summary.rightWins ? "left" : "right";
}

function buildScorePercents(summary) {
    const decisive = summary.leftWins + summary.rightWins;
    if (decisive <= 0) {
        return { left: 50, right: 50 };
    }

    const leftPercent = clamp(Math.round((summary.leftWins / decisive) * 100), 0, 100);
    return {
        left: leftPercent,
        right: 100 - leftPercent
    };
}

function buildStatusLabel(summary, momentum, leftMeta, rightMeta) {
    if (summary.leftWins === summary.rightWins) {
        return "DISPUTA EQUILIBRADA";
    }

    if (momentum.dominantSide === "left") {
        return `${leftMeta.displayBase} NA FRENTE`;
    }

    if (momentum.dominantSide === "right") {
        return `${rightMeta.displayBase} NA FRENTE`;
    }

    return "MOMENTUM NEUTRO";
}

function buildStreakLabel(streak, leftMeta, rightMeta) {
    if (!streak?.count) {
        return "SEM STREAK";
    }

    if (streak.winner === "left") {
        return `${leftMeta.displayBase} x${streak.count}`;
    }

    if (streak.winner === "right") {
        return `${rightMeta.displayBase} x${streak.count}`;
    }

    return `EMPATE x${streak.count}`;
}

function buildTimelineSignature(samples) {
    return samples.map((sample) => `${sample.time}:${sample.winner}`).join("|");
}

export function buildCandleBattleState({ leftCandles, rightCandles, leftMeta, rightMeta }) {
    const normalizedLeftMeta = buildMeta(leftMeta, "#22f0a2", "left");
    const normalizedRightMeta = buildMeta(rightMeta, "#ff5b8f", "right");
    const aligned = alignBattleCandles(leftCandles, rightCandles);
    const samples = buildSamples(aligned);
    const summary = summarizeWins(samples);
    const momentum = computeMomentum(samples, 10);
    const streak = computeCurrentStreak(samples);
    const leader = buildLeader(summary);
    const scorePercents = buildScorePercents(summary);

    return {
        leftMeta: normalizedLeftMeta,
        rightMeta: normalizedRightMeta,
        samples,
        summary,
        momentum,
        streak,
        streakLabel: buildStreakLabel(streak, normalizedLeftMeta, normalizedRightMeta),
        leader,
        leftNet: summary.leftWins - summary.rightWins,
        rightNet: summary.rightWins - summary.leftWins,
        leftScorePercent: scorePercents.left,
        rightScorePercent: scorePercents.right,
        latestSample: samples[samples.length - 1] ?? null,
        statusLabel: buildStatusLabel(summary, momentum, normalizedLeftMeta, normalizedRightMeta),
        timelineSignature: buildTimelineSignature(samples)
    };
}
