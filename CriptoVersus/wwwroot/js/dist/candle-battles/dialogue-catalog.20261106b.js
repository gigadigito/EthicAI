// Candle Battle dialogue catalog: types, semantic families, personalities and
// the per-language registry. Phrase data lives in the dialogue-phrases-*.ts
// modules; selection rules live in dialogue-engine.ts.
export const TEMPLATE_VARS = [
    'asset', 'opponent', 'round', 'remainingRounds', 'scoreDifference', 'changePercent', 'streak'
];
/** Semantic families keep similar jokes from stacking back to back. */
export const FAMILIES = [
    'wick', 'trend', 'portfolio', 'liquidation', 'hodl', 'moon', 'dip', 'volume',
    'volatility', 'support', 'resistance', 'novela', 'print', 'trade', 'wallet',
    'order', 'chart', 'color', 'streak', 'excuse', 'pressure', 'endgame',
    'opener', 'closer', 'whale', 'meme', 'timing', 'balance', 'luck', 'revenge'
];
/** Families that must not fire when the underlying market data is unavailable. */
export const FAMILY_DATA = {
    volume: ['volume'], volatility: ['volume'], whale: ['volume'], pressure: ['volume', 'score'],
    trend: ['change'], dip: ['change'], moon: ['change'], color: ['change'],
    streak: ['streak'], balance: ['score'], revenge: ['score'], endgame: ['score']
};
export const PERSONALITY_PROFILES = [
    'taunting', 'sarcastic', 'dramatic', 'confident', 'ironic', 'calm', 'underdog', 'selfDeprecating'
];
/** Tone affinities per personality; higher weight means the voice leans to it. */
export const PERSONALITY_TONES = {
    taunting: { taunting: 3, confident: 2, ironic: 1 },
    sarcastic: { sarcastic: 3, ironic: 2, selfDeprecating: 1 },
    dramatic: { dramatic: 3, taunting: 1, confident: 1 },
    confident: { confident: 3, taunting: 2, calm: 1 },
    ironic: { ironic: 3, sarcastic: 2, selfDeprecating: 1 },
    calm: { calm: 3, ironic: 1, confident: 1 },
    underdog: { underdog: 3, dramatic: 1, selfDeprecating: 2 },
    selfDeprecating: { selfDeprecating: 3, sarcastic: 2, underdog: 1 }
};
const hashString = (value) => {
    let h = 2166136261;
    for (const ch of value)
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
};
/** Stable per-asset voice: the same symbol keeps the same personality across battles. */
export function personalityFor(symbol) {
    return PERSONALITY_PROFILES[hashString(symbol.trim().toUpperCase()) % PERSONALITY_PROFILES.length];
}
export function templateVars(text) {
    const found = new Set();
    for (const match of text.matchAll(/\{(\w+)\}/g))
        found.add(match[1]);
    return [...found];
}
/** Fills template variables; returns null when a required value is unavailable. */
export function fillTemplate(text, data) {
    let failed = false;
    const filled = text.replace(/\{(\w+)\}/g, (_match, key) => {
        const value = data[key];
        if (value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value))) {
            failed = true;
            return '';
        }
        return String(value);
    });
    return failed ? null : filled;
}
const catalogs = new Map();
export const FALLBACK_LANGUAGE = 'en';
/**
 * Single source of truth for finished-match dialogue roles, keyed by the
 * stable catalog id shared by every language. For sequences the role belongs
 * to the author of the first turn (turns alternate roles); for phrases it is
 * the role of the speaker. Roles must be bound to arena sides through the
 * official match result, never inferred from left/right position.
 */
export const RESULT_ROLES = {
    'seq.041': 'winner', 'seq.042': 'loser', 'seq.043': 'winner', 'seq.044': 'winner',
    'seq.045': 'winner', 'seq.079': 'winner', 'seq.080': 'loser', 'seq.113': 'winner',
    'seq.114': 'winner', 'seq.115': 'loser', 'seq.136': 'winner', 'seq.146': 'winner',
    'seq.150': 'loser',
    'result.001': 'winner', 'result.002': 'loser', 'result.003': 'winner', 'result.004': 'winner',
    'result.005': 'winner', 'result.006': 'winner', 'result.007': 'winner', 'result.008': 'winner',
    'result.009': 'winner', 'result.010': 'winner', 'result.011': 'loser', 'result.012': 'winner',
    'result.013': 'winner', 'result.014': 'winner', 'result.015': 'winner', 'result.016': 'winner',
    'result.017': 'winner', 'result.018': 'loser', 'result.019': 'winner', 'result.020': 'winner',
    'result.021': 'winner', 'result.022': 'winner', 'result.023': 'loser', 'result.024': 'winner',
    'result.025': 'winner', 'result.026': 'winner', 'result.027': 'loser', 'result.028': 'winner',
    'result.029': 'winner', 'result.030': 'winner'
};
export function counterpartRole(role) {
    return role === 'winner' ? 'loser' : 'winner';
}
export function registerCatalog(catalog) {
    catalogs.set(catalog.language.toLowerCase(), catalog);
}
export function hasCatalog(language) {
    return catalogs.has(language.toLowerCase());
}
/**
 * Resolves the catalog for a culture. Fallback is explicit and atomic per
 * dialogue: a culture without a catalog falls back to English as a whole, so a
 * single conversation never mixes two languages.
 */
export function resolveCatalog(culture) {
    const normalized = culture.toLowerCase();
    const direct = catalogs.get(normalized);
    if (direct)
        return direct;
    const language = normalized.split('-')[0];
    const byLanguage = catalogs.get(language);
    if (byLanguage)
        return byLanguage;
    return catalogs.get(FALLBACK_LANGUAGE) ?? { language: FALLBACK_LANGUAGE, phrases: [], sequences: [] };
}
export function toPhrase(seed) {
    const phrase = {
        id: seed[0], family: seed[1], category: seed[2], length: seed[3], tone: seed[4], text: seed[5]
    };
    if (seed[2] === 'result')
        phrase.resultRole = RESULT_ROLES[seed[0]];
    return phrase;
}
export function toSequence(seed) {
    const sequence = {
        id: seed[0], family: seed[1], category: seed[2], moment: seed[3], tone: seed[4],
        turns: seed.slice(5).filter((turn) => typeof turn === 'string' && turn.length > 0)
    };
    if (seed[2] === 'result')
        sequence.leadRole = RESULT_ROLES[seed[0]];
    return sequence;
}
/** Categories that may speak in a given battle moment, most specific first. */
export const MOMENT_CATEGORIES = {
    banter: ['taunt', 'candle', 'crypto', 'volume'],
    roundWin: ['roundWin', 'taunt', 'candle', 'crypto'],
    roundLoss: ['roundLoss', 'comeback', 'crypto', 'taunt'],
    draw: ['draw', 'taunt', 'crypto'],
    leadChange: ['comeback', 'taunt', 'crypto'],
    opening: ['opening', 'taunt', 'crypto'],
    finale: ['finale', 'taunt', 'volume', 'crypto'],
    result: ['result']
};
/** Reading time by length class, in milliseconds. */
export const LINE_DURATION = { short: 1700, medium: 2500, long: 3600 };
/** Character bands used by the length tests (approximate ranges from the brief). */
export const LENGTH_BANDS = {
    short: [6, 70], medium: [28, 130], long: [75, 190]
};
