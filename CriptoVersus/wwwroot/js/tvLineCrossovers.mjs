import { normalizeChartTime } from "./tvChartTime.mjs";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function interpolateSeriesValue(points, time) {
    if (!Array.isArray(points) || points.length === 0) {
        return null;
    }

    if (time < points[0].time || time > points[points.length - 1].time) {
        return null;
    }

    if (time === points[0].time) {
        return points[0].value;
    }

    if (time === points[points.length - 1].time) {
        return points[points.length - 1].value;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];

        if (time < start.time || time > end.time) {
            continue;
        }

        const span = end.time - start.time;
        if (span === 0) {
            return end.value;
        }

        const ratio = clamp((time - start.time) / span, 0, 1);
        return start.value + ((end.value - start.value) * ratio);
    }

    return null;
}

export function normalizeSeriesForCrossovers(series, options = {}) {
    const diagnostics = options?.diagnostics ?? null;

    if (!Array.isArray(series)) {
        return [];
    }

    return series
        .map((point) => {
            const time = normalizeChartTime(point?.time, { diagnostics });
            const value = Number(point?.value);

            if (!Number.isFinite(time) || !Number.isFinite(value)) {
                diagnostics?.recordDiscardedEvent?.("invalid-crossover-point", point);
                return null;
            }

            return {
                time,
                value,
                raw: point
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
}

export function interpolateLineCrossover(prevA, currA, prevB, currB) {
    const prevTime = Math.max(prevA.time, prevB.time);
    const currTime = Math.min(currA.time, currB.time);

    if (!Number.isFinite(prevTime) || !Number.isFinite(currTime) || currTime < prevTime) {
        return null;
    }

    const prevAValue = interpolateSeriesValue([prevA, currA], prevTime);
    const prevBValue = interpolateSeriesValue([prevB, currB], prevTime);
    const currAValue = interpolateSeriesValue([prevA, currA], currTime);
    const currBValue = interpolateSeriesValue([prevB, currB], currTime);

    if (![prevAValue, prevBValue, currAValue, currBValue].every(Number.isFinite)) {
        return null;
    }

    const diffPrev = prevAValue - prevBValue;
    const diffCurr = currAValue - currBValue;
    const hasCrossover = diffPrev === 0
        || diffCurr === 0
        || (diffPrev < 0 && diffCurr > 0)
        || (diffPrev > 0 && diffCurr < 0);

    if (!hasCrossover) {
        return null;
    }

    const denominator = Math.abs(diffPrev) + Math.abs(diffCurr);
    const ratio = denominator === 0 ? 0 : Math.abs(diffPrev) / denominator;
    const safeRatio = clamp(ratio, 0, 1);
    const crossTime = prevTime + (safeRatio * (currTime - prevTime));
    const crossValue = prevAValue + (safeRatio * (currAValue - prevAValue));
    const direction = diffCurr >= diffPrev
        ? (diffCurr >= 0 ? "a-crosses-above" : "a-crosses-below")
        : (diffCurr <= 0 ? "a-crosses-below" : "a-crosses-above");

    return {
        time: crossTime,
        value: crossValue,
        direction,
        previous: {
            a: { time: prevTime, value: prevAValue, raw: prevA.raw },
            b: { time: prevTime, value: prevBValue, raw: prevB.raw }
        },
        current: {
            a: { time: currTime, value: currAValue, raw: currA.raw },
            b: { time: currTime, value: currBValue, raw: currB.raw }
        }
    };
}

export function findLineCrossovers(seriesA, seriesB, options = {}) {
    const diagnostics = options?.diagnostics ?? null;
    const normalizedA = normalizeSeriesForCrossovers(seriesA, { diagnostics });
    const normalizedB = normalizeSeriesForCrossovers(seriesB, { diagnostics });

    if (normalizedA.length < 2 || normalizedB.length < 2) {
        return [];
    }

    const crossovers = [];

    for (let indexA = 1; indexA < normalizedA.length; indexA += 1) {
        const prevA = normalizedA[indexA - 1];
        const currA = normalizedA[indexA];

        for (let indexB = 1; indexB < normalizedB.length; indexB += 1) {
            const prevB = normalizedB[indexB - 1];
            const currB = normalizedB[indexB];

            const overlapStart = Math.max(prevA.time, prevB.time);
            const overlapEnd = Math.min(currA.time, currB.time);
            if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd < overlapStart) {
                continue;
            }

            const crossover = interpolateLineCrossover(prevA, currA, prevB, currB);
            if (!crossover) {
                continue;
            }

            crossovers.push(crossover);
        }
    }

    const deduped = [];
    const seen = new Set();

    for (const crossover of crossovers.sort((a, b) => a.time - b.time || a.value - b.value)) {
        const key = `${crossover.time.toFixed(6)}:${crossover.value.toFixed(6)}:${crossover.direction}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(crossover);
    }

    diagnostics?.info?.("crossovers", {
        seriesAPoints: normalizedA.length,
        seriesBPoints: normalizedB.length,
        crossovers: deduped.length,
        items: deduped.map((item) => ({
            crossTime: item.time,
            crossValue: item.value,
            direction: item.direction
        }))
    });

    return deduped;
}
