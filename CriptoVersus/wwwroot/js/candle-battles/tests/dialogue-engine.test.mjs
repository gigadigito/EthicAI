import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CandleBattleDialogueEngine, lineDuration, resolveWinnerSide, RESULT_ROLES,
    fillTemplate, personalityFor, resolveCatalog, templateVars, LENGTH_BANDS
} from '../../dist/candle-battles/dialogue-engine.js';

const CULTURES = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'ja-JP', 'zh-CN'];

const contextFor = (matchId, overrides = {}) => ({
    matchId,
    culture: 'pt-BR',
    speaker: 'left',
    speakerSymbol: 'BTCUSDT',
    opponentSymbol: 'ETHUSDT',
    round: 6,
    expectedRounds: 18,
    score: { left: 4, right: 3 },
    moment: 'banter',
    changePercent: 2.5,
    hasVolume: true,
    streak: 2,
    ...overrides
});

test('contextual selection matches the battle moment and never leaks templates', () => {
    for (const moment of ['banter', 'roundWin', 'roundLoss', 'draw', 'leadChange', 'opening', 'finale', 'result']) {
        const engine = new CandleBattleDialogueEngine(true);
        const lines = engine.pickExchange(contextFor(11, { moment }), 0);
        assert.ok(lines.length >= 2, moment);
        for (const line of lines) {
            assert.ok(line.text.length > 0);
            assert.ok(!line.text.includes('{'), `${moment}: ${line.text}`);
            assert.ok(line.phraseId && line.family);
        }
        assert.notEqual(lines[0].side, lines[1].side);
    }
});

test('authored conversations keep both turns in one family and one id', () => {
    let conversations = 0;
    for (let matchId = 1; matchId <= 30; matchId++) {
        const engine = new CandleBattleDialogueEngine(true);
        for (let exchange = 0; exchange < 8; exchange++) {
            const lines = engine.pickExchange(contextFor(matchId, { round: exchange + 1, moment: exchange % 2 ? 'roundWin' : 'banter' }), exchange);
            const bases = new Set(lines.map(line => line.phraseId.split('#')[0]));
            if (bases.size === 1) {
                conversations++;
                assert.equal(new Set(lines.map(line => line.family)).size, 1, 'one family per conversation');
            } else {
                assert.equal(bases.size, 2, 'pair exchanges use two authored lines');
                assert.equal(lines.length, 2);
            }
        }
    }
    assert.ok(conversations >= 8, `expected authored conversations among the exchanges, got ${conversations}`);
});

test('anti-repetition keeps exact phrases fresh within a match', () => {
    const engine = new CandleBattleDialogueEngine();
    const texts = [];
    for (let exchange = 0; exchange < 40; exchange++) {
        const lines = engine.pickExchange(contextFor(77, { round: exchange + 1, moment: exchange % 3 === 0 ? 'roundWin' : 'banter' }), exchange);
        for (const line of lines) texts.push(line.text);
    }
    assert.equal(new Set(texts).size, texts.length, 'no exact phrase repeats while alternatives exist');
    assert.ok(engine.usedFamilyCount >= 6, `expected family variety, got ${engine.usedFamilyCount}`);
});

test('anti-repetition avoids stacking the same joke family back to back', () => {
    const engine = new CandleBattleDialogueEngine();
    let worstRun = 0;
    let run = 0;
    let previous = '';
    for (let exchange = 0; exchange < 40; exchange++) {
        const lines = engine.pickExchange(contextFor(78, { round: exchange + 1 }), exchange);
        const family = lines[0].family;
        run = family === previous ? run + 1 : 1;
        worstRun = Math.max(worstRun, run);
        previous = family;
    }
    assert.ok(worstRun <= 2, `family repeated ${worstRun} times in a row`);
});

test('different battles produce different conversations', () => {
    const openers = new Set();
    for (let matchId = 100; matchId < 120; matchId++) {
        const engine = new CandleBattleDialogueEngine(true);
        const [line] = engine.pickExchange(contextFor(matchId), 0);
        openers.add(line.text);
    }
    assert.ok(openers.size >= 12, `expected variety across matches, got ${openers.size}`);
});

test('personality is stable per asset and shapes the voice', () => {
    const first = personalityFor('BTCUSDT');
    for (let i = 0; i < 25; i++) assert.equal(personalityFor('BTCUSDT'), first);
    assert.notEqual(personalityFor('BTCUSDT'), undefined);
    const profiles = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'RUNEUSDT', 'STRKUSDT', 'AVAUSDT', 'PUMPUSDT', 'GTCUSDT'].map(personalityFor));
    assert.ok(profiles.size >= 4, `expected several profiles across assets, got ${profiles.size}`);
});

test('social capture is deterministic for the same match and context', () => {
    const options = {
        matchId: 41875,
        culture: 'pt-BR',
        leftSymbol: 'RUNEUSDT',
        rightSymbol: 'STRKUSDT',
        scoreA: 9,
        scoreB: 8,
        round: 17,
        expectedRounds: 18,
        finished: true,
        winner: 'left'
    };
    const a = new CandleBattleDialogueEngine(true).captureExchange(options);
    const b = new CandleBattleDialogueEngine(true).captureExchange(options);
    assert.deepEqual(a.map(line => line.text), b.map(line => line.text));
    assert.equal(a[0].side, 'left');
    assert.equal(a[0].kind, 'shout');
    assert.equal(a[1].kind, 'thought');
    const ongoing = new CandleBattleDialogueEngine(true).captureExchange({ ...options, finished: false, winner: null, round: 8 });
    const ongoing2 = new CandleBattleDialogueEngine(true).captureExchange({ ...options, finished: false, winner: null, round: 8 });
    assert.deepEqual(ongoing.map(line => line.text), ongoing2.map(line => line.text));
});

test('every supported culture renders one language per exchange without placeholders', () => {
    for (const culture of CULTURES) {
        const engine = new CandleBattleDialogueEngine(true);
        const lines = engine.pickExchange(contextFor(5, { culture, moment: 'roundWin' }), 0);
        for (const line of lines) {
            assert.ok(line.text.length > 0, culture);
            assert.ok(!line.text.includes('{'), `${culture}: ${line.text}`);
        }
        const texts = lines.map(line => line.text);
        const locale = resolveCatalog(culture);
        const en = resolveCatalog('en-US');
        const inCatalog = (catalog, text) => catalog.phrases.some(seed => seed[5] === text)
            || catalog.sequences.some(seed => seed.slice(5).includes(text));
        const allLocale = texts.every(text => inCatalog(locale, text));
        const allEn = texts.every(text => inCatalog(en, text));
        assert.ok(allLocale || allEn, `${culture}: exchange mixed languages: ${texts.join(' | ')}`);
    }
});

test('cultures without a catalog fall back to English as a whole exchange', () => {
    const engine = new CandleBattleDialogueEngine(true);
    const lines = engine.pickExchange(contextFor(5, { culture: 'ko-KR' }), 0);
    const en = resolveCatalog('en-US');
    for (const line of lines) {
        const known = en.phrases.some(seed => seed[5] === line.text) || en.sequences.some(seed => seed.slice(5).includes(line.text));
        assert.ok(known, `fallback leaked a non-english line: ${line.text}`);
    }
});

test('base phrases keep three distinct length formats and selection favors medium/long', () => {
    const pt = resolveCatalog('pt-BR');
    const groups = { short: [], medium: [], long: [] };
    for (const seed of pt.phrases) {
        const [, , , length, , text] = seed;
        groups[length].push(text.length);
        const [min, max] = LENGTH_BANDS[length];
        assert.ok(text.length >= min && text.length <= max, `${seed[0]} (${length}): ${text.length} chars`);
    }
    const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    assert.ok(median(groups.short) < median(groups.medium), 'short lines must be shorter than medium ones');
    assert.ok(median(groups.medium) < median(groups.long), 'medium lines must be shorter than long ones');
    assert.ok(groups.short.length > 50 && groups.medium.length > 50 && groups.long.length > 50, 'all three formats are populated');
    // Selection must prefer medium/long lines for comfortable bubble reading.
    const engine = new CandleBattleDialogueEngine();
    let mediumOrLong = 0;
    let total = 0;
    for (let exchange = 0; exchange < 120; exchange++) {
        const lines = engine.pickExchange(contextFor(21, { round: (exchange % 18) + 1 }), exchange);
        for (const line of lines) {
            total++;
            if (line.text.length > 40) mediumOrLong++;
        }
    }
    assert.ok(mediumOrLong / total >= 0.45, `medium/long share ${(mediumOrLong / total * 100).toFixed(1)}%`);
});

test('templates only render when the underlying data exists', () => {
    assert.equal(fillTemplate('Go {opponent}!', { opponent: 'ETH' }), 'Go ETH!');
    assert.equal(fillTemplate('{changePercent}% up', {}), null);
    assert.equal(fillTemplate('{streak} in a row', { streak: 3 }), '3 in a row');
    assert.deepEqual(templateVars('a {asset} b {round}'), ['asset', 'round']);
    const engine = new CandleBattleDialogueEngine(true);
    const lines = engine.pickExchange(contextFor(9, { changePercent: undefined, hasVolume: false, streak: undefined }), 0);
    for (const line of lines) {
        assert.ok(!line.text.includes('{'));
        assert.ok(!['volume', 'volatility', 'whale', 'pressure', 'streak'].includes(line.family), line.text);
    }
});

test('reading time grows with line length', () => {
    assert.ok(lineDuration('curta') <= lineDuration('uma fala de tamanho médio para o balão'));
    assert.ok(lineDuration('uma fala de tamanho médio para o balão') < lineDuration('uma fala bem mais longa que precisa de mais tempo de leitura no balão da arena'));
});

test('picking stays fast during a battle', () => {
    const started = Date.now();
    const engine = new CandleBattleDialogueEngine();
    for (let exchange = 0; exchange < 2000; exchange++) {
        engine.pickExchange(contextFor(3, { round: (exchange % 18) + 1 }), exchange);
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `2000 exchanges took ${elapsed}ms`);
});

test('simulated battles show low repetition and wide variety', () => {
    const matches = 30;
    const perMatch = 18;
    let totalLines = 0;
    const globalTexts = new Map();
    const families = new Set();
    let exactRepeats = 0;
    for (let matchId = 1; matchId <= matches; matchId++) {
        const engine = new CandleBattleDialogueEngine();
        const seen = new Set();
        for (let exchange = 0; exchange < perMatch; exchange++) {
            const lines = engine.pickExchange(contextFor(matchId, {
                round: exchange + 1,
                moment: exchange % 3 === 0 ? 'roundWin' : exchange % 5 === 0 ? 'draw' : 'banter'
            }), exchange);
            for (const line of lines) {
                totalLines++;
                families.add(line.family);
                globalTexts.set(line.text, (globalTexts.get(line.text) ?? 0) + 1);
                if (seen.has(line.text)) exactRepeats++;
                seen.add(line.text);
            }
        }
    }
    const distinct = globalTexts.size;
    const repeatRate = exactRepeats / totalLines;
    assert.equal(repeatRate, 0, `in-match exact repetition rate ${repeatRate}`);
    assert.ok(distinct >= matches * 4, `expected wide variety across ${matches} matches, got ${distinct} distinct lines`);
    assert.ok(families.size >= 12, `expected many joke families, got ${families.size}`);
    assert.ok(totalLines >= matches * perMatch * 2, 'expected two lines per exchange');
});

// Finished-match roles come from the official result, never from arena sides.
const roleOfLine = line => {
    const [id, turn] = String(line.phraseId).split('#');
    const base = RESULT_ROLES[id];
    if (base === undefined) return undefined;
    if (turn === undefined) return base;
    return Number(turn) % 2 === 0 ? base : (base === 'winner' ? 'loser' : 'winner');
};

const captureOptions = (overrides = {}) => ({
    matchId: 42035,
    culture: 'pt-BR',
    leftSymbol: 'ARKUSDT',
    rightSymbol: 'SKHYBUSDT',
    scoreA: 8,
    scoreB: 9,
    round: 17,
    expectedRounds: 18,
    finished: true,
    winnerSymbol: 'SKHYBUSDT',
    winner: 'right',
    ...overrides
});

const assertResultRoles = (lines, winnerSide) => {
    assert.equal(lines[0].side, 'left');
    assert.equal(lines[1].side, 'right');
    const winnerLine = lines[winnerSide === 'left' ? 0 : 1];
    const loserLine = lines[winnerSide === 'left' ? 1 : 0];
    assert.equal(roleOfLine(winnerLine), 'winner', `winner said: ${winnerLine.text} (${winnerLine.phraseId})`);
    assert.equal(roleOfLine(loserLine), 'loser', `loser said: ${loserLine.text} (${loserLine.phraseId})`);
    assert.equal(winnerLine.role, 'winner');
    assert.equal(loserLine.role, 'loser');
    assert.equal(winnerLine.kind, 'shout');
    assert.equal(loserLine.kind, 'thought');
    for (const line of lines) assert.ok(line.text.length > 0 && !line.text.includes('{'));
};

test('official winner symbol resolves the winning side, never the arena position', () => {
    assert.equal(resolveWinnerSide({ leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT', winnerSymbol: 'SKHYBUSDT', winner: 'left' }), 'right');
    assert.equal(resolveWinnerSide({ leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT', winnerSymbol: 'arkusdt' }), 'left');
    assert.equal(resolveWinnerSide({ leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT', winnerSymbol: ' ', winner: 'right' }), 'right');
    assert.equal(resolveWinnerSide({ leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT', winnerSymbol: null, winner: 'draw' }), 'draw');
    assert.equal(resolveWinnerSide({ leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT' }), 'draw');
    assert.equal(resolveWinnerSide({ leftSymbol: 'SKHYBUSDT', rightSymbol: 'ARKUSDT', winnerSymbol: 'ARKUSDT' }), 'right');
});

test('asset A wins: the winner only speaks victory lines and the loser only defeat lines', () => {
    for (let matchId = 1; matchId <= 60; matchId++) {
        const lines = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, leftSymbol: 'ARKUSDT', rightSymbol: 'SKHYBUSDT', scoreA: 9, scoreB: 8,
            winnerSymbol: 'ARKUSDT', winner: 'left'
        }));
        assertResultRoles(lines, 'left');
    }
});

test('asset B wins 8x9: roles follow the official result, not the left side', () => {
    for (let matchId = 1; matchId <= 60; matchId++) {
        const lines = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, scoreA: 8, scoreB: 9, winnerSymbol: 'SKHYBUSDT', winner: 'right'
        }));
        assertResultRoles(lines, 'right');
    }
});

test('a wide 17x1 score keeps the winner in the winner role', () => {
    for (let matchId = 1; matchId <= 40; matchId++) {
        const lines = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, scoreA: 1, scoreB: 17, winnerSymbol: 'SKHYBUSDT', winner: 'right'
        }));
        assertResultRoles(lines, 'right');
    }
});

test('asset order differing from the renderer order still binds roles to the symbols', () => {
    for (let matchId = 1; matchId <= 40; matchId++) {
        const swapped = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, leftSymbol: 'SKHYBUSDT', rightSymbol: 'ARKUSDT', scoreA: 9, scoreB: 8,
            winnerSymbol: 'ARKUSDT', winner: 'right'
        }));
        assertResultRoles(swapped, 'right');
        const mirrored = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, leftSymbol: 'SKHYBUSDT', rightSymbol: 'ARKUSDT', scoreA: 8, scoreB: 9,
            winnerSymbol: 'SKHYBUSDT', winner: 'left'
        }));
        assertResultRoles(mirrored, 'left');
    }
});

test('repeated captures of the same finished match keep identical, role-coherent dialogues', () => {
    const options = captureOptions({ matchId: 42035 });
    const renders = Array.from({ length: 5 }, () =>
        new CandleBattleDialogueEngine(true).captureExchange(options).map(line => line.text));
    for (const render of renders) assert.deepEqual(render, renders[0]);
    const lines = new CandleBattleDialogueEngine(true).captureExchange(options);
    assertResultRoles(lines, 'right');
});

test('loser-led conversations land their turns on the correct characters', () => {
    const loserLed = ['seq.042', 'seq.080', 'seq.115', 'seq.150'];
    let seen = 0;
    for (let matchId = 1; matchId <= 400; matchId++) {
        const lines = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({ matchId }));
        assertResultRoles(lines, 'right');
        const base = String(lines[1].phraseId).split('#')[0];
        if (loserLed.includes(base)) {
            seen++;
            assert.equal(roleOfLine(lines[1]), 'winner', lines[1].text);
            assert.equal(roleOfLine(lines[0]), 'loser', lines[0].text);
        }
    }
    assert.ok(seen >= 1, 'expected at least one loser-led conversation in the capture pool');
});

test('finished draws never invent a winner or claim victory', () => {
    for (let matchId = 1; matchId <= 40; matchId++) {
        const lines = new CandleBattleDialogueEngine(true).captureExchange(captureOptions({
            matchId, scoreA: 9, scoreB: 9, winnerSymbol: null, winner: 'draw'
        }));
        assert.equal(lines[0].side, 'left');
        assert.equal(lines[1].side, 'right');
        for (const line of lines) {
            assert.equal(roleOfLine(line), undefined, line.text);
            assert.equal(line.kind, 'speech');
        }
    }
});

test('every result catalog entry in every culture declares its winner/loser role', () => {
    for (const culture of CULTURES) {
        const catalog = resolveCatalog(culture);
        for (const seed of catalog.phrases)
            if (seed[2] === 'result') assert.ok(RESULT_ROLES[seed[0]], `${culture}: ${seed[0]} has no result role`);
        for (const seed of catalog.sequences)
            if (seed[2] === 'result') assert.ok(RESULT_ROLES[seed[0]], `${culture}: ${seed[0]} has no result role`);
    }
});
