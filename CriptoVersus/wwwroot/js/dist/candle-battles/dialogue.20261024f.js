import { CandleBattleDialogueEngine, lineDuration } from './dialogue-engine.20261024f.js';
export { lineDuration };
const hash = (value) => {
    let h = 2166136261;
    for (const ch of value)
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
};
function contextToMoment(context, speaker, culture) {
    const speakerCandle = speaker === 'left' ? context.left : context.right;
    const opponentCandle = speaker === 'left' ? context.right : context.left;
    const changePercent = speakerCandle && speakerCandle.open > 0
        ? (speakerCandle.close / speakerCandle.open - 1) * 100
        : undefined;
    const leaderDelta = context.score.left - context.score.right;
    const fromSpeaker = speaker === 'left' ? leaderDelta : -leaderDelta;
    const moment = fromSpeaker === 0 ? 'draw'
        : context.lastWinner === speaker ? 'roundWin'
            : context.lastWinner === 'draw' ? 'draw'
                : context.lastWinner ? 'roundLoss'
                    : 'banter';
    return {
        matchId: context.matchId,
        culture,
        speaker,
        speakerSymbol: speakerCandle?.symbol ?? (speaker === 'left' ? 'LEFT' : 'RIGHT'),
        opponentSymbol: opponentCandle?.symbol ?? (speaker === 'left' ? 'RIGHT' : 'LEFT'),
        round: context.round,
        expectedRounds: 18,
        score: context.score,
        moment,
        changePercent,
        hasVolume: false,
        streak: undefined
    };
}
/**
 * Compatibility wrapper: two coherent lines for one battle exchange. The
 * `slot` makes the choice reproducible for the same match and moment.
 */
export function dialogueLines(context, culture, slot) {
    const engine = new CandleBattleDialogueEngine(true);
    const speaker = slot % 2 === 0 ? 'left' : 'right';
    const lines = engine.pickExchange(contextToMoment(context, speaker, culture), slot).slice(0, 2);
    return [
        { ...lines[0], side: speaker },
        { ...lines[1], side: speaker === 'left' ? 'right' : 'left' }
    ];
}
/** Closing exchange of a finished battle: victory line and defeat line. */
export function finalLines(matchId, score, culture) {
    const engine = new CandleBattleDialogueEngine(true);
    const winner = score.left === score.right ? 'draw' : score.left > score.right ? 'left' : 'right';
    return engine.captureExchange({
        matchId,
        culture,
        leftSymbol: 'LEFT',
        rightSymbol: 'RIGHT',
        scoreA: score.left,
        scoreB: score.right,
        round: 18,
        expectedRounds: 18,
        finished: true,
        winner
    });
}
/** Schedules one two/three-turn exchange, then a cooldown before the next. */
export class DialogueClock {
    constructor() {
        this.slot = 0;
        this.phase = 'wait';
        this.phaseTime = 0;
        this.turns = 2;
    }
    reset() {
        this.slot = 0;
        this.phase = 'wait';
        this.phaseTime = 0;
        this.turns = 2;
    }
    advance(delta, matchId, round, turns = 2, lineDurationMs = 1800) {
        this.turns = Math.max(2, Math.min(3, turns));
        const hold = Math.max(900, Math.min(6000, lineDurationMs));
        this.phaseTime += Math.max(0, delta);
        if (this.phase === 'wait' && this.phaseTime >= (this.slot === 0 ? 400 : 8000 + hash(`${matchId}:${round}:${this.slot}`) % 7001)) {
            this.phase = 'first';
            this.phaseTime = 0;
            return { slot: this.slot, line: 0 };
        }
        if (this.phase === 'first' && this.phaseTime >= hold) {
            this.phase = 'gap1';
            this.phaseTime = 0;
            return null;
        }
        if (this.phase === 'gap1' && this.phaseTime >= 400) {
            this.phase = 'second';
            this.phaseTime = 0;
            return { slot: this.slot, line: 1 };
        }
        if (this.phase === 'second' && this.phaseTime >= hold) {
            if (this.turns >= 3) {
                this.phase = 'gap2';
                this.phaseTime = 0;
                return null;
            }
            this.phase = 'wait';
            this.phaseTime = 0;
            this.slot++;
            return null;
        }
        if (this.phase === 'gap2' && this.phaseTime >= 400) {
            this.phase = 'third';
            this.phaseTime = 0;
            return { slot: this.slot, line: 2 };
        }
        if (this.phase === 'third' && this.phaseTime >= hold) {
            this.phase = 'wait';
            this.phaseTime = 0;
            this.slot++;
        }
        return null;
    }
    get visible() { return this.phase === 'first' || this.phase === 'second' || this.phase === 'third'; }
}
