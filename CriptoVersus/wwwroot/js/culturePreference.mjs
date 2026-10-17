const PREFERENCE_KEY = 'cv_culture';
const SOURCE_KEY = 'cv_culture_source';
const COOKIE_MAX_AGE_SECONDS = 31536000;

function normalizeTag(tag) {
    return String(tag ?? '').trim().toLowerCase();
}

function readCookie(name) {
    try {
        const match = document.cookie
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(name + '='));
        return match ? decodeURIComponent(match.substring(name.length + 1)) : null;
    } catch (e) {
        return null;
    }
}

function writeCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value)
        + '; path=/; max-age=' + COOKIE_MAX_AGE_SECONDS + '; SameSite=Lax';
}

/**
 * Matches ordered browser language tags (navigator.languages) against the
 * supported language catalog rendered by the server. Regional variants fall
 * back to the supported language of the same base ("pt-PT" -> "pt-BR").
 * Returns the supported route culture or null.
 */
export function matchSupportedCulture(languageTags, supportedLanguages) {
    const supported = (supportedLanguages ?? [])
        .map((language) => ({
            route: normalizeTag(language.route),
            culture: normalizeTag(language.culture),
            aliases: (language.aliases ?? []).map(normalizeTag)
        }))
        .filter((language) => language.route);

    for (const rawTag of languageTags ?? []) {
        const tag = normalizeTag(rawTag);
        if (!tag) {
            continue;
        }

        const exact = supported.find((language) =>
            language.route === tag
            || language.culture === tag
            || language.aliases.includes(tag));

        if (exact) {
            return exact.route;
        }

        const neutral = tag.split(/[-_]/)[0];
        const neutralMatch = supported.find((language) =>
            language.route === neutral || language.culture === neutral);

        if (neutralMatch) {
            return neutralMatch.route;
        }
    }

    return null;
}

export function detectPreferredCulture(supportedLanguages, languages) {
    const browserLanguages = languages
        ?? (typeof navigator !== 'undefined'
            ? (Array.isArray(navigator.languages) && navigator.languages.length > 0
                ? navigator.languages
                : [navigator.language])
            : []);

    return matchSupportedCulture(browserLanguages, supportedLanguages);
}

export function readPersistedCulture() {
    try {
        const stored = localStorage.getItem(PREFERENCE_KEY);
        if (stored) {
            return stored;
        }
    } catch (e) { }

    return readCookie(PREFERENCE_KEY);
}

function persistCulture(culture, source) {
    try {
        localStorage.setItem(PREFERENCE_KEY, culture);
        if (source) {
            localStorage.setItem(SOURCE_KEY, source);
        }
    } catch (e) { }

    writeCookie(PREFERENCE_KEY, culture);
}

export function setPreferredCulture(culture) {
    if (!culture) {
        return null;
    }

    persistCulture(culture, 'manual');
    return culture;
}

/**
 * Keeps the persisted preference consistent across localStorage and the cookie
 * and, only when no preference exists yet, records the browser language so the
 * next request can be served in it. Never overwrites a stored preference.
 */
export function syncPreferredCulture(supportedLanguages) {
    const persisted = readPersistedCulture();
    if (persisted) {
        persistCulture(persisted);
        return persisted;
    }

    const detected = detectPreferredCulture(supportedLanguages);
    if (detected) {
        persistCulture(detected, 'auto');
    }

    return detected;
}
