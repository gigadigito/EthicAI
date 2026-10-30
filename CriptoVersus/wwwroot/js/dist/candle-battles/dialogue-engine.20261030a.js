// CandleBattleDialogueEngine: contextual, anti-repetitive dialogue selection
// shared by the Phaser battles and the social capture. Pure local logic: no
// HTTP, no timers, deterministic under a seed.
import { FAMILY_DATA, LINE_DURATION, MOMENT_CATEGORIES, counterpartRole, fillTemplate, personalityFor, resolveCatalog, templateVars, toPhrase, toSequence } from './dialogue-catalog.20261030a.js';
import './dialogue-phrases-pt.20261030a.js';
import './dialogue-phrases-en.20261030a.js';
import './dialogue-phrases-es-fr-de.20261030a.js';
import './dialogue-phrases-it-ja-zh.20261030a.js';
// Re-exported so consumers (and tests) share one catalog module instance even
// when the published runtime rewrites relative imports with cache-busting tags.
export { fillTemplate, personalityFor, resolveCatalog, templateVars, LENGTH_BANDS, RESULT_ROLES, counterpartRole } from './dialogue-catalog.20261030a.js';
/**
 * Single source of truth for the finished-match roles: the official
 * `winnerSymbol` decides which side won; the explicit side is only a fallback
 * when the symbol is unavailable. An unrecognized result never invents a
 * winner beyond the given fallback, and an undecided result is a draw.
 */
export function resolveWinnerSide(options) {
    const official = options.winnerSymbol?.trim().toLowerCase();
    if (official) {
        if (official === options.leftSymbol.trim().toLowerCase())
            return 'left';
        if (official === options.rightSymbol.trim().toLowerCase())
            return 'right';
    }
    return options.winner === 'left' || options.winner === 'right' ? options.winner : 'draw';
}
const FALLBACK = 'en';
const indexCache = new Map();
function indexFor(language) {
    const cached = indexCache.get(language);
    if (cached)
        return cached;
    const catalog = resolveCatalog(language);
    const index = { language: catalog.language, phrases: new Map(), sequences: new Map() };
    for (const seed of catalog.phrases) {
        const phrase = toPhrase(seed);
        index.phrases.set(phrase.id, phrase);
    }
    for (const seed of catalog.sequences) {
        const sequence = toSequence(seed);
        index.sequences.set(sequence.id, sequence);
    }
    indexCache.set(language, index);
    return index;
}
/** Drop the memoized indexes (used by tests that register catalogs late). */
export function resetCatalogIndex() {
    indexCache.clear();
}
/**
 * Selection space: the union of the localized and fallback catalogs, keyed by
 * stable id with localized metadata preferred. Cultures with a partial catalog
 * keep the full id variety and fall back per exchange, never per turn.
 */
function mergedIndex(locale, fallback) {
    const phrases = new Map(fallback.phrases);
    for (const [id, phrase] of locale.phrases)
        phrases.set(id, phrase);
    const sequences = new Map(fallback.sequences);
    for (const [id, sequence] of locale.sequences)
        sequences.set(id, sequence);
    return { language: locale.language, phrases, sequences };
}
const hashString = (value) => {
    let h = 2166136261;
    for (const ch of value)
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
};
const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const shortName = (symbol) => symbol.replace(/USDT$/i, '');
const CATEGORY_WEIGHT = {
    result: 6, roundWin: 5, roundLoss: 5, comeback: 5, draw: 4, finale: 4,
    opening: 3, candle: 3, volume: 3, taunt: 2, crypto: 1
};
const MOMENT_MOMENTS = {
    banter: ['banter'], roundWin: ['roundWin', 'banter'], roundLoss: ['roundLoss', 'banter'],
    draw: ['draw', 'banter'], leadChange: ['leadChange', 'banter'], opening: ['opening', 'banter'],
    finale: ['finale', 'banter'], result: ['result']
};
function kindFor(tone, role) {
    if (role === 'opener')
        return tone === 'dramatic' ? 'shout' : 'speech';
    return tone === 'selfDeprecating' || tone === 'calm' ? 'thought' : 'speech';
}
export class CandleBattleDialogueEngine {
    constructor(deterministic = false) {
        this.deterministic = deterministic;
        this.usedIds = new Set();
        this.familyCounts = new Map();
        this.recentFamilies = [];
        this.usedSequences = new Set();
        this.usageOrder = new Map();
        this.counter = 0;
        this.exchange = 0;
        this.lastTones = [];
    }
    reset() {
        this.usedIds.clear();
        this.familyCounts.clear();
        this.recentFamilies = [];
        this.usedSequences.clear();
        this.usageOrder.clear();
        this.counter = 0;
        this.exchange = 0;
    }
    /** 2–3 coherent turns for one exchange; never mixes languages inside it. */
    pickExchange(context, exchangeIndex) {
        if (exchangeIndex !== undefined)
            this.exchange = exchangeIndex;
        const locale = indexFor(context.culture);
        const fallback = indexFor(FALLBACK);
        const reference = mergedIndex(locale, fallback);
        const data = this.templateData(context);
        const replyContext = {
            ...context,
            speaker: context.speaker === 'left' ? 'right' : 'left',
            speakerSymbol: context.opponentSymbol,
            opponentSymbol: context.speakerSymbol
        };
        const replyData = this.templateData(replyContext);
        // Conversations (2–3 turns) and independent pairs must both appear:
        // the structure itself is part of the variety. Result moments always use
        // an authored conversation so victory/defeat lines stay coherent.
        const wantsConversation = context.moment === 'result'
            || this.rollFor(context, 55, `form:${this.exchange}`) < 0.62;
        const sequence = wantsConversation ? this.pickSequence(context, reference) : undefined;
        let turns;
        let tones;
        if (sequence) {
            const source = locale.sequences.has(sequence.id) ? locale : fallback;
            const localized = source.sequences.get(sequence.id);
            turns = localized.turns.map((turn, index) => ({
                text: fillTemplate(turn, data) ?? turn.replace(/\{\w+\}/g, ''),
                phraseId: `${sequence.id}#${index}`,
                family: sequence.family
            }));
            tones = localized.turns.map(() => localized.tone);
        }
        else {
            const [opener, reply] = this.pickPair(context, replyContext, reference);
            const localize = locale.phrases.has(opener.id) && locale.phrases.has(reply.id);
            const source = localize ? locale : fallback;
            const openerText = source.phrases.get(opener.id);
            const replyText = source.phrases.get(reply.id);
            turns = [
                { text: fillTemplate(openerText.text, data) ?? openerText.text.replace(/\{\w+\}/g, ''), phraseId: opener.id, family: opener.family },
                { text: fillTemplate(replyText.text, replyData) ?? replyText.text.replace(/\{\w+\}/g, ''), phraseId: reply.id, family: reply.family }
            ];
            tones = [opener.tone, reply.tone];
        }
        const sides = this.bindSides(context, sequence, turns.length);
        const roles = this.bindRoles(context, sequence, turns.length);
        const lines = turns.map((turn, i) => ({
            side: sides[i],
            kind: kindFor(tones[i] ?? 'taunting', i === 0 ? 'opener' : 'reply'),
            text: turn.text,
            phraseId: turn.phraseId,
            family: turn.family,
            ...(roles[i] ? { role: roles[i] } : {})
        }));
        this.exchange++;
        return lines;
    }
    /** Side of each turn: by role for finished matches, alternating otherwise. */
    bindSides(context, sequence, count) {
        const opponent = context.speaker === 'left' ? 'right' : 'left';
        if (context.moment !== 'result' || !context.speakerRole) {
            return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? context.speaker : opponent));
        }
        const speakerRole = context.speakerRole;
        const lead = sequence?.leadRole ?? speakerRole;
        return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? lead : counterpartRole(lead)) === speakerRole ? context.speaker : opponent);
    }
    bindRoles(context, sequence, count) {
        if (context.moment !== 'result' || !context.speakerRole)
            return Array.from({ length: count }, () => undefined);
        const speakerRole = context.speakerRole;
        const lead = sequence?.leadRole ?? speakerRole;
        return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? lead : counterpartRole(lead)));
    }
    /** Deterministic two-line capture dialogue; frozen and coherent per match. */
    captureExchange(options) {
        const winnerSide = resolveWinnerSide(options);
        const decided = options.finished === true && winnerSide !== 'draw';
        const winner = winnerSide === 'right' ? 'right' : 'left';
        const context = {
            matchId: options.matchId,
            culture: options.culture,
            speaker: decided ? winner : 'left',
            speakerSymbol: decided
                ? (winner === 'left' ? options.leftSymbol : options.rightSymbol)
                : options.leftSymbol,
            opponentSymbol: decided
                ? (winner === 'left' ? options.rightSymbol : options.leftSymbol)
                : options.rightSymbol,
            speakerRole: decided ? 'winner' : undefined,
            round: options.round,
            expectedRounds: options.expectedRounds,
            score: { left: options.scoreA, right: options.scoreB },
            moment: options.finished
                ? (decided ? 'result' : 'draw')
                : (options.round <= 3 ? 'opening' : options.expectedRounds - options.round <= 3 ? 'finale' : 'banter'),
            changePercent: options.changePercent,
            hasVolume: options.hasVolume,
            streak: options.streak
        };
        const lines = this.pickExchange(context);
        const left = lines.find(line => line.side === 'left') ?? lines[0];
        const right = lines.find(line => line.side === 'right') ?? lines[1];
        if (decided) {
            return [
                { ...left, side: 'left', kind: winner === 'left' ? 'shout' : 'thought' },
                { ...right, side: 'right', kind: winner === 'right' ? 'shout' : 'thought' }
            ];
        }
        return [
            { ...left, side: 'left', kind: 'speech' },
            { ...right, side: 'right', kind: 'speech' }
        ];
    }
    templateData(context) {
        const leaderDelta = context.score.left - context.score.right;
        const fromSpeaker = context.speaker === 'left' ? leaderDelta : -leaderDelta;
        const data = {
            asset: shortName(context.speakerSymbol),
            opponent: shortName(context.opponentSymbol),
            round: context.round,
            remainingRounds: Math.max(0, context.expectedRounds - context.round)
        };
        if (Number.isFinite(fromSpeaker))
            data.scoreDifference = Math.abs(fromSpeaker);
        if (typeof context.changePercent === 'number' && Number.isFinite(context.changePercent)) {
            data.changePercent = Number(context.changePercent.toFixed(2));
        }
        if (typeof context.streak === 'number' && Number.isFinite(context.streak))
            data.streak = Math.abs(context.streak);
        return data;
    }
    dataFlags(context) {
        const flags = new Set(['score']);
        if (typeof context.changePercent === 'number')
            flags.add('change');
        if (context.hasVolume)
            flags.add('volume');
        if (typeof context.streak === 'number')
            flags.add('streak');
        return flags;
    }
    familyAllowed(family, flags) {
        const needed = FAMILY_DATA[family];
        if (!needed)
            return true;
        return needed.every(flag => flags.has(flag));
    }
    seedFor(context, salt) {
        return hashString(`${context.matchId}:${context.round}:${context.speaker}:${this.exchange}:${salt}`);
    }
    scorePhrase(phrase, context, data, personality, lengthBias, random) {
        const categories = MOMENT_CATEGORIES[context.moment];
        const categoryRank = categories.indexOf(phrase.category);
        const toneWeight = this.toneWeight(personality, phrase.tone);
        const familyCount = this.familyCounts.get(phrase.family) ?? 0;
        const recent = this.recentFamilies.includes(phrase.family);
        return (categoryRank >= 0 ? CATEGORY_WEIGHT[phrase.category] * 0.3 : 0)
            + toneWeight * 0.45
            + (lengthBias[phrase.length] ?? 0)
            + (recent ? -2.5 : 0)
            - familyCount * 0.6
            + random() * 3.4;
    }
    /** Language-agnostic jitter: the same phrase id always draws the same roll. */
    rollFor(context, salt, id) {
        return mulberry32(this.seedFor(context, salt) ^ hashString(id))();
    }
    /** Renders one exchange from a single catalog so a dialogue never mixes languages. */
    renderTurns(ids, data, locale, fallback) {
        const localize = ids.every(id => locale.phrases.has(id) || locale.sequences.has(id));
        const source = localize ? locale : fallback;
        return ids.map(id => {
            const sequence = source.sequences.get(id);
            if (sequence) {
                return sequence.turns.map((turn, index) => ({
                    text: fillTemplate(turn, data) ?? turn.replace(/\{\w+\}/g, ''),
                    phraseId: `${id}#${index}`,
                    family: sequence.family
                }));
            }
            const phrase = source.phrases.get(id) ?? fallback.phrases.get(id);
            return [{
                    text: phrase ? (fillTemplate(phrase.text, data) ?? phrase.text.replace(/\{\w+\}/g, '')) : '',
                    phraseId: id,
                    family: phrase?.family ?? 'taunt'
                }];
        }).flat();
    }
    toneWeight(personality, tone) {
        const weights = PERSONALITY_TONES_LOCAL[personality];
        return (weights[tone] ?? 0) * 1.15;
    }
    pickPhrase(context, data, flags, lengthBias, salt, reference, role) {
        const personality = personalityFor(context.speakerSymbol);
        const categories = MOMENT_CATEGORIES[context.moment];
        const eligible = [];
        for (const phrase of reference.phrases.values()) {
            if (!categories.includes(phrase.category))
                continue;
            if (role !== undefined && phrase.resultRole !== role)
                continue;
            if (!this.familyAllowed(phrase.family, flags))
                continue;
            const vars = templateVars(phrase.text);
            if (vars.some(variable => data[variable] === undefined))
                continue;
            eligible.push(phrase);
        }
        // Never repeat a line while unused alternatives exist; when everything
        // is spent, reuse the least recently used ones first.
        const unused = eligible.filter(phrase => !this.usedIds.has(phrase.id));
        const pool = unused.length ? unused
            : eligible.sort((a, b) => (this.usageOrder.get(a.id) ?? 0) - (this.usageOrder.get(b.id) ?? 0)).slice(0, Math.max(1, Math.ceil(eligible.length / 3)));
        let best;
        let bestScore = -Infinity;
        for (const phrase of pool) {
            const score = this.scorePhrase(phrase, context, data, personality, lengthBias, () => this.rollFor(context, salt, phrase.id));
            if (score > bestScore) {
                bestScore = score;
                best = phrase;
            }
        }
        if (!best && role !== undefined) {
            for (const phrase of reference.phrases.values()) {
                if (phrase.resultRole === role) {
                    best = phrase;
                    break;
                }
            }
        }
        if (!best) {
            for (const phrase of reference.phrases.values()) {
                if (phrase.category === 'taunt') {
                    best = phrase;
                    break;
                }
            }
        }
        if (!best)
            throw new Error('Candle Battle dialogue catalog is empty');
        this.markUsed(best.id, best.family);
        return best;
    }
    pickSequence(context, reference) {
        const flags = this.dataFlags(context);
        const data = this.templateData(context);
        const moments = MOMENT_MOMENTS[context.moment];
        const eligible = [];
        for (const sequence of reference.sequences.values()) {
            if (!moments.includes(sequence.moment))
                continue;
            if (context.moment === 'result' && sequence.leadRole === undefined)
                continue;
            if (!this.familyAllowed(sequence.family, flags))
                continue;
            if (sequence.turns.some(turn => {
                const vars = templateVars(turn);
                return vars.some(variable => data[variable] === undefined);
            }))
                continue;
            eligible.push(sequence);
        }
        const unused = eligible.filter(sequence => !this.usedSequences.has(sequence.id));
        const pool = unused.length ? unused
            : eligible.sort((a, b) => (this.usageOrder.get(a.id) ?? 0) - (this.usageOrder.get(b.id) ?? 0)).slice(0, Math.max(1, Math.ceil(eligible.length / 3)));
        let best;
        let bestScore = -Infinity;
        for (const sequence of pool) {
            const recent = this.recentFamilies.includes(sequence.family);
            const toneWeight = this.toneWeight(personalityFor(context.speakerSymbol), sequence.tone);
            const richness = sequence.turns.reduce((sum, turn) => sum + turn.length, 0) / Math.max(1, sequence.turns.length);
            const score = CATEGORY_WEIGHT[sequence.category] * 0.3 + toneWeight * 0.45
                + (richness > 55 ? 1.6 : richness > 35 ? 0.7 : 0)
                + (recent ? -2.5 : 0) + this.rollFor(context, 77, sequence.id) * 3.4;
            if (score > bestScore) {
                bestScore = score;
                best = sequence;
            }
        }
        if (!best)
            return undefined;
        this.usedSequences.add(best.id);
        this.markUsed(best.id, best.family);
        return best;
    }
    pickPair(context, replyContext, reference) {
        const speakerRole = context.moment === 'result' ? (context.speakerRole ?? 'winner') : undefined;
        const mediumBias = { short: 0, medium: 2.2, long: 1.8 };
        const opener = this.pickPhrase(context, this.templateData(context), this.dataFlags(context), mediumBias, 11, reference, speakerRole);
        const replyBias = { short: 0.2, medium: 2, long: 1.6 };
        const reply = this.pickPhrase(replyContext, this.templateData(replyContext), this.dataFlags(context), replyBias, 22, reference, speakerRole ? counterpartRole(speakerRole) : undefined);
        return [opener, reply];
    }
    markUsed(id, family) {
        this.usedIds.add(id);
        this.usageOrder.set(id, this.counter++);
        this.familyCounts.set(family, (this.familyCounts.get(family) ?? 0) + 1);
        this.recentFamilies = [family, ...this.recentFamilies.filter(item => item !== family)].slice(0, 4);
    }
    /** Exposed for diversity tests: how many distinct phrase ids this match used. */
    get usedPhraseCount() { return this.usedIds.size; }
    get usedFamilyCount() { return this.familyCounts.size; }
}
// Local mirror keeps the engine free of cycles with personality lookups in tests.
const PERSONALITY_TONES_LOCAL = {
    taunting: { taunting: 3, confident: 2, ironic: 1 },
    sarcastic: { sarcastic: 3, ironic: 2, selfDeprecating: 1 },
    dramatic: { dramatic: 3, taunting: 1, confident: 1 },
    confident: { confident: 3, taunting: 2, calm: 1 },
    ironic: { ironic: 3, sarcastic: 2, selfDeprecating: 1 },
    calm: { calm: 3, ironic: 1, confident: 1 },
    underdog: { underdog: 3, dramatic: 1, selfDeprecating: 2 },
    selfDeprecating: { selfDeprecating: 3, sarcastic: 2, underdog: 1 }
};
/** Reading duration (ms) for a line, scaled by its length class. */
export function lineDuration(text) {
    const length = text.length <= 50 ? 'short' : text.length <= 105 ? 'medium' : 'long';
    return LINE_DURATION[length];
}
