function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizePoints(points) {
    if (!Array.isArray(points)) {
        return [];
    }

    return points
        .map((point) => {
            const time = Number(point?.time);
            const value = Number(point?.value);

            if (!Number.isFinite(time) || !Number.isFinite(value)) {
                return null;
            }

            return { time, value };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
}

function normalizeSymbol(symbol) {
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

function toUnixSeconds(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (value instanceof Date) {
        return Math.floor(value.getTime() / 1000);
    }

    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }

    return null;
}

function interpolateSeriesValue(points, time) {
    if (!Array.isArray(points) || points.length === 0) {
        return null;
    }

    if (time < points[0].time || time > points[points.length - 1].time) {
        return null;
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

    return points[points.length - 1]?.value ?? null;
}

function buildBattleSamples(leftPoints, rightPoints) {
    if (!Array.isArray(leftPoints) || !Array.isArray(rightPoints) || leftPoints.length === 0 || rightPoints.length === 0) {
        return [];
    }

    const overlapStart = Math.max(leftPoints[0].time, rightPoints[0].time);
    const overlapEnd = Math.min(
        leftPoints[leftPoints.length - 1].time,
        rightPoints[rightPoints.length - 1].time);

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd <= overlapStart) {
        return [];
    }

    const times = Array.from(new Set([
        ...leftPoints.map((point) => point.time),
        ...rightPoints.map((point) => point.time)
    ]))
        .filter((time) => time >= overlapStart && time <= overlapEnd)
        .sort((a, b) => a - b);

    return times
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

function buildGameMinuteLabel(matchStartTimeUtc, eventTime) {
    const startUnix = toUnixSeconds(matchStartTimeUtc);
    if (!Number.isFinite(startUnix)) {
        return buildUtcClockLabel(eventTime);
    }

    const elapsedSeconds = Math.max(0, Math.round(eventTime - startUnix));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function buildUtcClockLabel(eventTime) {
    const date = new Date(eventTime * 1000);
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

function resolveSeriesSide(scoreEvent, leftMeta, rightMeta, leftTeamId, rightTeamId) {
    const numericTeamId = Number(scoreEvent?.teamId);
    if (Number.isFinite(numericTeamId)) {
        if (Number.isFinite(Number(leftTeamId)) && numericTeamId === Number(leftTeamId)) {
            return "left";
        }

        if (Number.isFinite(Number(rightTeamId)) && numericTeamId === Number(rightTeamId)) {
            return "right";
        }
    }

    const eventSymbol = normalizeSymbol(scoreEvent?.teamSymbol);
    if (!eventSymbol) {
        return null;
    }

    if (eventSymbol === normalizeSymbol(leftMeta?.symbol)) {
        return "left";
    }

    if (eventSymbol === normalizeSymbol(rightMeta?.symbol)) {
        return "right";
    }

    return null;
}

function normalizeScoreEvents(scoreEvents) {
    if (!Array.isArray(scoreEvents)) {
        return [];
    }

    return scoreEvents
        .map((scoreEvent) => {
            const eventTime = toUnixSeconds(scoreEvent?.eventTimeUtc ?? scoreEvent?.time ?? scoreEvent?.eventTime);
            const points = Number(scoreEvent?.points ?? 0);
            const matchScoreEventId = Number(scoreEvent?.matchScoreEventId ?? 0);

            if (!Number.isFinite(eventTime) || !Number.isFinite(points) || points <= 0) {
                return null;
            }

            return {
                matchScoreEventId,
                eventTime,
                points,
                teamId: scoreEvent?.teamId ?? null,
                teamSymbol: typeof scoreEvent?.teamSymbol === "string" ? scoreEvent.teamSymbol : "",
                ruleType: typeof scoreEvent?.ruleType === "string" ? scoreEvent.ruleType : "",
                eventType: typeof scoreEvent?.eventType === "string" ? scoreEvent.eventType : "",
                reasonCode: typeof scoreEvent?.reasonCode === "string" ? scoreEvent.reasonCode : "",
                description: typeof scoreEvent?.description === "string" ? scoreEvent.description : ""
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.eventTime !== b.eventTime) {
                return a.eventTime - b.eventTime;
            }

            return a.matchScoreEventId - b.matchScoreEventId;
        });
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

function resolveEventPlotPoint(scoreEvent, side, leftPoints, rightPoints, crossoverMatches) {
    if (isCrossoverScoreEvent(scoreEvent)) {
        const matchingCrossovers = crossoverMatches
            .map((crossover, index) => ({ crossover, index }))
            .filter((entry) => entry.crossover.side === side && !entry.crossover.used);

        if (matchingCrossovers.length === 0) {
            return null;
        }

        matchingCrossovers.sort((a, b) => {
            const deltaA = Math.abs(a.crossover.crossTime - scoreEvent.eventTime);
            const deltaB = Math.abs(b.crossover.crossTime - scoreEvent.eventTime);
            if (deltaA !== deltaB) {
                return deltaA - deltaB;
            }

            return a.crossover.crossTime - b.crossover.crossTime;
        });

        const winner = matchingCrossovers[0];
        crossoverMatches[winner.index].used = true;

        return {
            time: winner.crossover.crossTime,
            value: winner.crossover.crossValue
        };
    }

    const seriesPoints = side === "left" ? leftPoints : rightPoints;
    const seriesValue = interpolateSeriesValue(seriesPoints, scoreEvent.eventTime);
    if (!Number.isFinite(seriesValue)) {
        return null;
    }

    return {
        time: scoreEvent.eventTime,
        value: seriesValue
    };
}

function buildStackOffset(stackIndex) {
    if (stackIndex <= 0) {
        return 0;
    }

    const level = Math.ceil(stackIndex / 2);
    const direction = stackIndex % 2 === 1 ? -1 : 1;
    return direction * level * 18;
}

export function buildScoreEventMarkersModel({
    leftPoints,
    rightPoints,
    scoreEvents,
    leftMeta,
    rightMeta,
    leftTeamId,
    rightTeamId,
    matchStartTimeUtc
}) {
    const normalizedLeftPoints = normalizePoints(leftPoints);
    const normalizedRightPoints = normalizePoints(rightPoints);
    const normalizedScoreEvents = normalizeScoreEvents(scoreEvents);
    const crossoverMatches = buildBattleCrossovers(normalizedLeftPoints, normalizedRightPoints)
        .map((crossover) => ({ ...crossover, used: false }));

    if (normalizedLeftPoints.length === 0 || normalizedRightPoints.length === 0 || normalizedScoreEvents.length === 0) {
        return [];
    }

    const overlapStart = Math.max(normalizedLeftPoints[0].time, normalizedRightPoints[0].time);
    const overlapEnd = Math.min(
        normalizedLeftPoints[normalizedLeftPoints.length - 1].time,
        normalizedRightPoints[normalizedRightPoints.length - 1].time);

    if (!Number.isFinite(overlapStart) || !Number.isFinite(overlapEnd) || overlapEnd < overlapStart) {
        return [];
    }

    const stackState = new Map();

    return normalizedScoreEvents
        .map((scoreEvent) => {
            const side = resolveSeriesSide(scoreEvent, leftMeta, rightMeta, leftTeamId, rightTeamId);
            if (!side) {
                return null;
            }

            if (scoreEvent.eventTime < overlapStart || scoreEvent.eventTime > overlapEnd) {
                return null;
            }

            const plotPoint = resolveEventPlotPoint(scoreEvent, side, normalizedLeftPoints, normalizedRightPoints, crossoverMatches);
            if (!plotPoint || !Number.isFinite(plotPoint.time) || !Number.isFinite(plotPoint.value)) {
                return null;
            }

            const meta = side === "left" ? leftMeta : rightMeta;
            const minuteBucket = Math.floor(plotPoint.time / 60);
            const stackKey = `${side}:${minuteBucket}`;
            const stackIndex = stackState.get(stackKey) ?? 0;
            stackState.set(stackKey, stackIndex + 1);

            return {
                key: `score:${scoreEvent.matchScoreEventId || `${side}:${scoreEvent.eventTime}:${stackIndex}`}`,
                side,
                time: plotPoint.time,
                value: plotPoint.value,
                stackIndex,
                stackOffsetPx: buildStackOffset(stackIndex),
                teamId: scoreEvent.teamId,
                teamSymbol: scoreEvent.teamSymbol || meta?.symbol || "",
                logoUrl: typeof meta?.logoUrl === "string" ? meta.logoUrl : "",
                accentColor: typeof meta?.accentColor === "string" ? meta.accentColor : "",
                points: scoreEvent.points,
                reason: scoreEvent.description || scoreEvent.reasonCode || scoreEvent.eventType || scoreEvent.ruleType || "Score event",
                ruleType: scoreEvent.ruleType,
                minuteLabel: buildGameMinuteLabel(matchStartTimeUtc, scoreEvent.eventTime)
            };
        })
        .filter(Boolean);
}
