// Candle Battle dialogue catalog: types, semantic families, personalities and
// the per-language registry. Phrase data lives in the dialogue-phrases-*.ts
// modules; selection rules live in dialogue-engine.ts.

export type Side = 'left' | 'right';
export type DialogueCategory =
    | 'taunt' | 'candle' | 'roundWin' | 'roundLoss' | 'comeback'
    | 'draw' | 'crypto' | 'volume' | 'opening' | 'finale' | 'result';
export type DialogueTone =
    | 'taunting' | 'sarcastic' | 'dramatic' | 'confident'
    | 'ironic' | 'calm' | 'underdog' | 'selfDeprecating';
export type DialogueLength = 'short' | 'medium' | 'long';
export type DialogueMoment =
    | 'banter' | 'roundWin' | 'roundLoss' | 'draw'
    | 'leadChange' | 'opening' | 'finale' | 'result';
export type DialogueDataFlag = 'change' | 'volume' | 'streak' | 'score';

/** [id, family, category, length, tone, text] */
export type PhraseSeed = readonly [string, string, DialogueCategory, DialogueLength, DialogueTone, string];
/** [id, family, category, moment, tone, opening, reply, comeback?] */
export type SequenceSeed = readonly [string, string, DialogueCategory, DialogueMoment, DialogueTone, string, string, (string | undefined)?];

export interface DialogueCatalog {
    language: string;
    phrases: readonly PhraseSeed[];
    sequences: readonly SequenceSeed[];
}

export interface DialoguePhrase {
    id: string;
    family: string;
    category: DialogueCategory;
    length: DialogueLength;
    tone: DialogueTone;
    text: string;
}

export interface DialogueSequence {
    id: string;
    family: string;
    category: DialogueCategory;
    moment: DialogueMoment;
    tone: DialogueTone;
    turns: string[];
}

export interface DialogueLine {
    side: Side;
    kind: 'speech' | 'shout' | 'thought';
    text: string;
    phraseId?: string;
    family?: string;
}

export interface TemplateData {
    asset?: string;
    opponent?: string;
    round?: number;
    remainingRounds?: number;
    scoreDifference?: number;
    changePercent?: number;
    streak?: number;
}

export const TEMPLATE_VARS = [
    'asset', 'opponent', 'round', 'remainingRounds', 'scoreDifference', 'changePercent', 'streak'
] as const;

/** Semantic families keep similar jokes from stacking back to back. */
export const FAMILIES = [
    'wick', 'trend', 'portfolio', 'liquidation', 'hodl', 'moon', 'dip', 'volume',
    'volatility', 'support', 'resistance', 'novela', 'print', 'trade', 'wallet',
    'order', 'chart', 'color', 'streak', 'excuse', 'pressure', 'endgame',
    'opener', 'closer', 'whale', 'meme', 'timing', 'balance', 'luck', 'revenge'
] as const;

/** Families that must not fire when the underlying market data is unavailable. */
export const FAMILY_DATA: Partial<Record<string, DialogueDataFlag[]>> = {
    volume: ['volume'], volatility: ['volume'], whale: ['volume'], pressure: ['volume', 'score'],
    trend: ['change'], dip: ['change'], moon: ['change'], color: ['change'],
    streak: ['streak'], balance: ['score'], revenge: ['score'], endgame: ['score']
};

export const PERSONALITY_PROFILES = [
    'taunting', 'sarcastic', 'dramatic', 'confident', 'ironic', 'calm', 'underdog', 'selfDeprecating'
] as const;
export type PersonalityProfile = typeof PERSONALITY_PROFILES[number];

/** Tone affinities per personality; higher weight means the voice leans to it. */
export const PERSONALITY_TONES: Record<PersonalityProfile, Partial<Record<DialogueTone, number>>> = {
    taunting: { taunting: 3, confident: 2, ironic: 1 },
    sarcastic: { sarcastic: 3, ironic: 2, selfDeprecating: 1 },
    dramatic: { dramatic: 3, taunting: 1, confident: 1 },
    confident: { confident: 3, taunting: 2, calm: 1 },
    ironic: { ironic: 3, sarcastic: 2, selfDeprecating: 1 },
    calm: { calm: 3, ironic: 1, confident: 1 },
    underdog: { underdog: 3, dramatic: 1, selfDeprecating: 2 },
    selfDeprecating: { selfDeprecating: 3, sarcastic: 2, underdog: 1 }
};

const hashString = (value: string): number => {
    let h = 2166136261;
    for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
};

/** Stable per-asset voice: the same symbol keeps the same personality across battles. */
export function personalityFor(symbol: string): PersonalityProfile {
    return PERSONALITY_PROFILES[hashString(symbol.trim().toUpperCase()) % PERSONALITY_PROFILES.length];
}

export function templateVars(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\{(\w+)\}/g)) found.add(match[1]);
    return [...found];
}

/** Fills template variables; returns null when a required value is unavailable. */
export function fillTemplate(text: string, data: TemplateData): string | null {
    let failed = false;
    const filled = text.replace(/\{(\w+)\}/g, (_match, key: string) => {
        const value = (data as Record<string, unknown>)[key];
        if (value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value))) {
            failed = true;
            return '';
        }
        return String(value);
    });
    return failed ? null : filled;
}

const catalogs = new Map<string, DialogueCatalog>();
export const FALLBACK_LANGUAGE = 'en';

export function registerCatalog(catalog: DialogueCatalog): void {
    catalogs.set(catalog.language.toLowerCase(), catalog);
}

export function hasCatalog(language: string): boolean {
    return catalogs.has(language.toLowerCase());
}

/**
 * Resolves the catalog for a culture. Fallback is explicit and atomic per
 * dialogue: a culture without a catalog falls back to English as a whole, so a
 * single conversation never mixes two languages.
 */
export function resolveCatalog(culture: string): DialogueCatalog {
    const normalized = culture.toLowerCase();
    const direct = catalogs.get(normalized);
    if (direct) return direct;
    const language = normalized.split('-')[0];
    const byLanguage = catalogs.get(language);
    if (byLanguage) return byLanguage;
    return catalogs.get(FALLBACK_LANGUAGE) ?? { language: FALLBACK_LANGUAGE, phrases: [], sequences: [] };
}

export function toPhrase(seed: PhraseSeed): DialoguePhrase {
    return { id: seed[0], family: seed[1], category: seed[2], length: seed[3], tone: seed[4], text: seed[5] };
}

export function toSequence(seed: SequenceSeed): DialogueSequence {
    return {
        id: seed[0], family: seed[1], category: seed[2], moment: seed[3], tone: seed[4],
        turns: seed.slice(5).filter((turn): turn is string => typeof turn === 'string' && turn.length > 0)
    };
}

/** Categories that may speak in a given battle moment, most specific first. */
export const MOMENT_CATEGORIES: Record<DialogueMoment, DialogueCategory[]> = {
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
export const LINE_DURATION: Record<DialogueLength, number> = { short: 1700, medium: 2500, long: 3600 };

/** Character bands used by the length tests (approximate ranges from the brief). */
export const LENGTH_BANDS: Record<DialogueLength, [number, number]> = {
    short: [6, 70], medium: [28, 130], long: [75, 190]
};
