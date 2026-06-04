const mediaProbeCache = new Map();
let currentMediaCulture = "en";

function logMediaWarning(message, payload) {
    console.warn(`[MEDIA_I18N] ${message}`, payload);
}

function logMediaInfo(message, payload) {
    console.info(`[MEDIA_I18N] ${message}`, payload);
}

export function normalizeMediaCulture(culture) {
    const normalized = String(culture ?? "").trim().toLowerCase();
    return normalized === "pt" || normalized === "pt-br"
        ? "pt"
        : "en";
}

export function getMediaCulture() {
    return currentMediaCulture;
}

export function setMediaCulture(culture) {
    currentMediaCulture = normalizeMediaCulture(culture);
    return currentMediaCulture;
}

export function getCultureFallbackChain(culture) {
    const normalized = normalizeMediaCulture(culture);
    return [...new Set([normalized, "en", "pt"])];
}

export function buildLocalizedMediaCandidates({
    mediaType,
    fileName,
    culture,
    context,
    legacyPath,
    version
}) {
    if (!fileName || !mediaType || !context) {
        return [];
    }

    const safeFileName = String(fileName).replace(/^[/\\]+/, "");
    const safeContext = String(context).replace(/^[/\\]+|[/\\]+$/g, "");
    const versionSuffix = version ? `?v=${encodeURIComponent(version)}` : "";
    const localized = getCultureFallbackChain(culture).map((candidateCulture) =>
        `/media/${mediaType}/${candidateCulture}/${safeContext}/${encodeURIComponent(safeFileName)}${versionSuffix}`);

    if (!legacyPath) {
        return localized;
    }

    return [...localized, `${legacyPath}${versionSuffix}`];
}

async function probeMediaCandidate(url) {
    if (!url) {
        return false;
    }

    if (mediaProbeCache.has(url)) {
        return mediaProbeCache.get(url);
    }

    if (typeof fetch !== "function") {
        mediaProbeCache.set(url, true);
        return true;
    }

    try {
        const response = await fetch(url, {
            method: "HEAD",
            cache: "no-store"
        });
        const ok = response.ok;
        mediaProbeCache.set(url, ok);
        return ok;
    } catch {
        mediaProbeCache.set(url, false);
        return false;
    }
}

export async function resolveLocalizedMediaPath({
    mediaType,
    fileName,
    culture,
    context,
    legacyPath,
    version,
    logLabel
}) {
    const candidates = buildLocalizedMediaCandidates({
        mediaType,
        fileName,
        culture,
        context,
        legacyPath,
        version
    });

    for (const candidate of candidates) {
        if (await probeMediaCandidate(candidate)) {
            const normalizedCulture = normalizeMediaCulture(culture);
            const resolvedCulture = candidate.includes(`/media/${mediaType}/`)
                ? candidate.split(`/media/${mediaType}/`)[1]?.split("/")[0] ?? "unknown"
                : "legacy";
            const fallbackUsed = resolvedCulture === "legacy"
                || resolvedCulture !== normalizedCulture;
            logMediaInfo("asset resolved", {
                mediaType,
                fileName,
                requestedCulture: normalizedCulture,
                resolvedCulture,
                context,
                resolvedPath: candidate,
                fallbackUsed
            });
            return candidate;
        }
    }

    logMediaWarning("asset not found", {
        mediaType,
        fileName,
        culture: normalizeMediaCulture(culture),
        context,
        legacyPath,
        label: logLabel ?? null
    });
    return null;
}

export async function resolveLocalizedAudioPath(fileName, culture, context, options = {}) {
    return resolveLocalizedMediaPath({
        mediaType: "audio",
        fileName,
        culture,
        context,
        legacyPath: options.legacyPath ?? null,
        version: options.version ?? null,
        logLabel: options.logLabel ?? null
    });
}

export async function resolveLocalizedVideoPath(fileName, culture, context, options = {}) {
    return resolveLocalizedMediaPath({
        mediaType: "video",
        fileName,
        culture,
        context,
        legacyPath: options.legacyPath ?? null,
        version: options.version ?? null,
        logLabel: options.logLabel ?? null
    });
}
