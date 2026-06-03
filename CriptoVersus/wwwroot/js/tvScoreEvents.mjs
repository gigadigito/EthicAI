import { normalizeChartPoints, normalizeChartTime } from "./tvChartTime.mjs";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeScoreEventSymbol(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
        return "";
    }

    const compact = symbol
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
    const quoteSuffixes = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDP", "USD"];

    for (const suffix of quoteSuffixes) {
        if (compact.endsWith(suffix) && compact.length > suffix.length) {
            return compact.slice(0, compact.length - suffix.length);
        }
    }

    return compact;
}

export function interpolateSeriesValue(points, time) {
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

function buildBattleSamples(leftPoints, rightPoints) {
    if (!Array.isArray(leftPoints) || !Array.isArray(rightPoints) || leftPoints.length < 2 || rightPoints.length < 2) {
        return [];
    }

    const overlapStart = Math.max(leftPoints[0].time, rightPoints[0].time);
    const overlapEnd = Math.min(leftPoints[leftPoints.length - 1].time, rightPoints[rightPoints.length - 1].time);

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd <= overlapStart) {
        return [];
    }

    const timeline = new Set([overlapStart, overlapEnd]);

    leftPoints.forEach((point) => {
        if (point.time >= overlapStart && point.time <= overlapEnd) {
            timeline.add(point.time);
        }
    });

    rightPoints.forEach((point) => {
        if (point.time >= overlapStart && point.time <= overlapEnd) {
            timeline.add(point.time);
        }
    });

    return Array.from(timeline)
        .sort((a, b) => a - b)
        .map((time) => {
            const leftValue = interpolateSeriesValue(leftPoints, time);
            const rightValue = interpolateSeriesValue(rightPoints, time);

            if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
                return null;
            }

            return {
                time,
                leftValue,
                rightValue
            };
        })
        .filter(Boolean);
}

function buildBattleCrossovers(leftPoints, rightPoints) {
    const samples = buildBattleSamples(leftPoints, rightPoints);
    if (samples.length < 2) {
        return [];
    }

    const crossovers = [];

    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];

        if (!previous || !current || current.time <= previous.time) {
            continue;
        }

        const previousDiff = previous.rightValue - previous.leftValue;
        const currentDiff = current.rightValue - current.leftValue;
        const rightCrossedUp = previousDiff < 0 && currentDiff > 0;
        const leftCrossedUp = previousDiff > 0 && currentDiff < 0;

        if (!rightCrossedUp && !leftCrossedUp) {
            continue;
        }

        const denominator = Math.abs(previousDiff) + Math.abs(currentDiff);
        const t = denominator <= 0 ? 0.5 : clamp(Math.abs(previousDiff) / denominator, 0, 1);
        const crossTime = previous.time + ((current.time - previous.time) * t);
        const crossValue = previous.leftValue + ((current.leftValue - previous.leftValue) * t);

        if (!Number.isFinite(crossTime) || !Number.isFinite(crossValue)) {
            continue;
        }

        crossovers.push({
            side: leftCrossedUp ? "left" : "right",
            crossTime,
            crossValue,
            previousTime: previous.time,
            currentTime: current.time
        });
    }

    return crossovers;
}

export function buildGameMinuteLabel(matchStartTimeUtc, eventTime) {
    const startUnix = normalizeChartTime(matchStartTimeUtc);
    if (!Number.isFinite(startUnix)) {
        const date = new Date(eventTime * 1000);
        return `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}`;
    }

    const elapsedSeconds = Math.max(0, Math.round(eventTime - startUnix));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function buildScoreEventDto(scoreEvent, options = {}) {
    const rawTime =
        scoreEvent?.eventTimeUtc
        ?? scoreEvent?.occurredAtUtc
        ?? scoreEvent?.createdAtUtc
        ?? scoreEvent?.capturedAtUtc
        ?? scoreEvent?.time
        ?? scoreEvent?.eventTime;
    const time = normalizeChartTime(rawTime, { diagnostics: options?.diagnostics });
    const points = Number(scoreEvent?.points ?? 0);
    const matchScoreEventId = Number(scoreEvent?.matchScoreEventId ?? 0);

    if (!Number.isFinite(time) || !Number.isFinite(points) || points <= 0) {
        options?.diagnostics?.recordDiscardedEvent?.("invalid-event", scoreEvent);
        return null;
    }

    const description = typeof scoreEvent?.description === "string" && scoreEvent.description.length > 0
        ? scoreEvent.description
        : typeof scoreEvent?.reasonCode === "string" && scoreEvent.reasonCode.length > 0
            ? scoreEvent.reasonCode
            : typeof scoreEvent?.eventType === "string" && scoreEvent.eventType.length > 0
                ? scoreEvent.eventType
                : "Score event";

    return {
        time,
        markerTime: time,
        teamSymbol: typeof scoreEvent?.teamSymbol === "string" ? scoreEvent.teamSymbol : "",
        eventType: typeof scoreEvent?.eventType === "string" ? scoreEvent.eventType : "",
        score: points,
        minute: buildGameMinuteLabel(options?.matchStartTimeUtc, time),
        description,
        raw: scoreEvent,
        matchScoreEventId,
        teamId: scoreEvent?.teamId ?? null,
        ruleType: typeof scoreEvent?.ruleType === "string" ? scoreEvent.ruleType : "",
        reasonCode: typeof scoreEvent?.reasonCode === "string" ? scoreEvent.reasonCode : ""
    };
}

function normalizeScoreEvents(scoreEvents, options = {}) {
    if (!Array.isArray(scoreEvents)) {
        return [];
    }

    return scoreEvents
        .map((scoreEvent) => buildScoreEventDto(scoreEvent, options))
        .filter(Boolean)
        .sort((a, b) => a.time === b.time ? a.matchScoreEventId - b.matchScoreEventId : a.time - b.time);
}

function resolveScoreEventSeriesSide(scoreEvent, leftMeta, rightMeta, leftTeamId, rightTeamId) {
    const eventSymbol = normalizeScoreEventSymbol(scoreEvent?.teamSymbol);
    const leftSymbol = normalizeScoreEventSymbol(leftMeta?.symbol);
    const rightSymbol = normalizeScoreEventSymbol(rightMeta?.symbol);

    if (eventSymbol) {
        if (eventSymbol === leftSymbol) {
            return "left";
        }

        if (eventSymbol === rightSymbol) {
            return "right";
        }

        return null;
    }

    const numericTeamId = Number(scoreEvent?.teamId);
    if (Number.isFinite(numericTeamId)) {
        if (Number.isFinite(Number(leftTeamId)) && numericTeamId === Number(leftTeamId)) {
            return "left";
        }

        if (Number.isFinite(Number(rightTeamId)) && numericTeamId === Number(rightTeamId)) {
            return "right";
        }
    }

    return null;
}

function isCrossoverScoreEvent(scoreEvent) {
    const parts = [
        scoreEvent?.ruleType,
        scoreEvent?.eventType,
        scoreEvent?.reasonCode,
        scoreEvent?.description
    ]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .join(" ")
        .toUpperCase();

    return parts.includes("CROSSOVER");
}

function buildScoreEventStackOffset(stackIndex) {
    if (stackIndex <= 0) {
        return 0;
    }

    const level = Math.ceil(stackIndex / 2);
    const direction = stackIndex % 2 === 1 ? -1 : 1;
    return direction * level * 18;
}

function resolveScoreEventPlotPoint(scoreEvent, side, leftPoints, rightPoints, crossoverMatches) {
    if (isCrossoverScoreEvent(scoreEvent)) {
        const eventTime = scoreEvent.time;
        const crossoverMatchToleranceSeconds = 180;
        let eligibleCrossovers = crossoverMatches
            .map((crossover, index) => ({ crossover, index }))
            .filter((entry) => {
                if (entry.crossover.side !== side || entry.crossover.used) {
                    return false;
                }

                const windowStart = Math.min(entry.crossover.previousTime, entry.crossover.currentTime);
                const windowEnd = Math.max(entry.crossover.previousTime, entry.crossover.currentTime);
                return eventTime >= windowStart && eventTime <= windowEnd;
            });

        if (eligibleCrossovers.length === 0) {
            eligibleCrossovers = crossoverMatches
                .map((crossover, index) => ({ crossover, index }))
                .filter((entry) => {
                    if (entry.crossover.side !== side || entry.crossover.used) {
                        return false;
                    }

                    return Math.abs(entry.crossover.crossTime - eventTime) <= crossoverMatchToleranceSeconds;
                });
        }

        if (eligibleCrossovers.length === 0) {
            return null;
        }

        eligibleCrossovers.sort((a, b) => {
            const deltaA = Math.abs(a.crossover.crossTime - eventTime);
            const deltaB = Math.abs(b.crossover.crossTime - eventTime);
            if (deltaA !== deltaB) {
                return deltaA - deltaB;
            }

            return a.crossover.crossTime - b.crossover.crossTime;
        });

        const winner = eligibleCrossovers[0];
        crossoverMatches[winner.index].used = true;

        return {
            time: winner.crossover.crossTime,
            value: winner.crossover.crossValue
        };
    }

    const seriesPoints = side === "left" ? leftPoints : rightPoints;
    const value = interpolateSeriesValue(seriesPoints, scoreEvent.time);
    if (!Number.isFinite(value)) {
        return null;
    }

    return {
        time: scoreEvent.time,
        value
    };
}

export function buildScoreEventMarkersModel(payload, options = {}) {
    const diagnostics = options?.diagnostics ?? null;
    const normalizedLeftPoints = normalizeChartPoints(payload?.leftPoints, {
        diagnostics,
        teamSymbol: payload?.leftMeta?.symbol,
        source: payload?.leftSource ?? payload?.source ?? "raw snapshots"
    });
    const normalizedRightPoints = normalizeChartPoints(payload?.rightPoints, {
        diagnostics,
        teamSymbol: payload?.rightMeta?.symbol,
        source: payload?.rightSource ?? payload?.source ?? "raw snapshots"
    });
    const normalizedScoreEvents = normalizeScoreEvents(payload?.scoreEvents, {
        diagnostics,
        matchStartTimeUtc: payload?.matchStartTimeUtc
    });

    if (normalizedLeftPoints.length === 0 || normalizedRightPoints.length === 0 || normalizedScoreEvents.length === 0) {
        return [];
    }

    const overlapStart = Math.max(
        normalizedLeftPoints[0]?.time ?? Number.NaN,
        normalizedRightPoints[0]?.time ?? Number.NaN);
    const overlapEnd = Math.min(
        normalizedLeftPoints[normalizedLeftPoints.length - 1]?.time ?? Number.NaN,
        normalizedRightPoints[normalizedRightPoints.length - 1]?.time ?? Number.NaN);

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd < overlapStart) {
        return [];
    }

    const stackState = new Map();
    const crossoverMatches = buildBattleCrossovers(normalizedLeftPoints, normalizedRightPoints)
        .map((crossover) => ({ ...crossover, used: false }));
    const plotCache = payload?.plotCache instanceof Map ? payload.plotCache : null;

    return normalizedScoreEvents
        .map((scoreEvent) => {
            const side = resolveScoreEventSeriesSide(
                scoreEvent,
                payload?.leftMeta,
                payload?.rightMeta,
                payload?.leftTeamId,
                payload?.rightTeamId);
            if (!side) {
                diagnostics?.recordDiscardedEvent?.("unresolved-series-side", scoreEvent);
                return null;
            }

            if (scoreEvent.time < overlapStart || scoreEvent.time > overlapEnd) {
                diagnostics?.recordDiscardedEvent?.("event-out-of-range", {
                    scoreEvent,
                    overlapStart,
                    overlapEnd
                });
                return null;
            }

            const plotCacheKey = scoreEvent.matchScoreEventId > 0
                ? `score:${scoreEvent.matchScoreEventId}`
                : null;
            let plotPoint = plotCacheKey ? plotCache?.get(plotCacheKey) ?? null : null;

            if (!plotPoint || !Number.isFinite(plotPoint.time) || !Number.isFinite(plotPoint.value)) {
                plotPoint = resolveScoreEventPlotPoint(
                    scoreEvent,
                    side,
                    normalizedLeftPoints,
                    normalizedRightPoints,
                    crossoverMatches);

                if (plotCacheKey && plotPoint && Number.isFinite(plotPoint.time) && Number.isFinite(plotPoint.value)) {
                    plotCache?.set(plotCacheKey, {
                        time: plotPoint.time,
                        value: plotPoint.value
                    });
                }
            }

            if (!plotPoint || !Number.isFinite(plotPoint.time) || !Number.isFinite(plotPoint.value)) {
                diagnostics?.recordDiscardedEvent?.("invalid-plot-point", scoreEvent);
                return null;
            }

            const meta = side === "left" ? payload?.leftMeta : payload?.rightMeta;
            const minuteBucket = Math.floor(plotPoint.time / 60);
            const stackKey = `${side}:${minuteBucket}`;
            const stackIndex = stackState.get(stackKey) ?? 0;
            stackState.set(stackKey, stackIndex + 1);

            return {
                key: `score:${scoreEvent.matchScoreEventId || `${side}:${scoreEvent.time}:${stackIndex}`}`,
                side,
                time: plotPoint.time,
                value: plotPoint.value,
                teamSymbol: scoreEvent.teamSymbol || meta?.symbol || "",
                eventType: scoreEvent.eventType,
                score: scoreEvent.score,
                minute: scoreEvent.minute,
                description: scoreEvent.description,
                raw: scoreEvent.raw,
                teamId: scoreEvent.teamId,
                markerTime: plotPoint.time,
                normalizedTime: scoreEvent.time,
                firstSeriesTime: overlapStart,
                lastSeriesTime: overlapEnd,
                stackIndex,
                stackOffsetPx: buildScoreEventStackOffset(stackIndex),
                logoUrl: typeof meta?.logoUrl === "string" ? meta.logoUrl : "",
                accentColor: typeof meta?.accentColor === "string" ? meta.accentColor : "",
                points: scoreEvent.score,
                reason: scoreEvent.description,
                minuteLabel: scoreEvent.minute
            };
        })
        .filter(Boolean);
}
