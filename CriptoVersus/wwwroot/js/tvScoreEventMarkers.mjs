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

            const seriesPoints = side === "left" ? normalizedLeftPoints : normalizedRightPoints;
            const seriesValue = interpolateSeriesValue(seriesPoints, scoreEvent.eventTime);
            if (!Number.isFinite(seriesValue)) {
                return null;
            }

            const meta = side === "left" ? leftMeta : rightMeta;
            const minuteBucket = Math.floor(scoreEvent.eventTime / 60);
            const stackKey = `${side}:${minuteBucket}`;
            const stackIndex = stackState.get(stackKey) ?? 0;
            stackState.set(stackKey, stackIndex + 1);

            return {
                key: `score:${scoreEvent.matchScoreEventId || `${side}:${scoreEvent.eventTime}:${stackIndex}`}`,
                side,
                time: scoreEvent.eventTime,
                value: seriesValue,
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
