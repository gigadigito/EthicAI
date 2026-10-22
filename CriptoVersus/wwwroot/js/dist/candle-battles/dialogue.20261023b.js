import { candleChangePercent } from './model.20261023b.js';
const catalogs = {
    en: { strength: 'MY STRENGTH IS {value}!', score: '{mine} TO {theirs}! KEEP UP!', change: 'I MOVED {value}%!', territory: 'LOOK AT MY TERRITORY!', round: 'ROUND {value}! READY?', taunt: 'YOU WILTED CANDLE!', comeback: 'THIS ISN’T OVER!', worry: 'That chart looks strong...', retort: 'LOOK AT YOUR CROOKED WICK!', winner: 'I TOLD YOU!', loser: 'I WANT A REMATCH!', draw: 'NEXT ROUND, THEN!' },
    pt: { strength: 'MINHA FORÇA TÁ EM {value}!', score: '{mine} A {theirs}! APRENDE!', change: 'VARIEI {value}%!', territory: 'OLHA ESSE TERRITÓRIO!', round: 'ROUND {value}! PREPARADO?', taunt: 'SEU CANDLE MURCHO!', comeback: 'ISSO NÃO ACABOU!', worry: 'Esse gráfico tá forte...', retort: 'OLHA TEU PAVIO TORTO!', winner: 'EU AVISEI!', loser: 'EU QUERO REVANCHE!', draw: 'NO PRÓXIMO ROUND!' },
    es: { strength: '¡MI FUERZA ESTÁ EN {value}!', score: '¡{mine} A {theirs}! ¡APRENDE!', change: '¡CAMBIÉ {value}%!', territory: '¡MIRA MI TERRITORIO!', round: '¡RONDA {value}! ¿LISTO?', taunt: '¡VELA MARCHITA!', comeback: '¡ESTO NO TERMINA!', worry: 'Ese gráfico se ve fuerte...', retort: '¡MIRA TU MECHA TORCIDA!', winner: '¡TE LO DIJE!', loser: '¡QUIERO LA REVANCHA!', draw: '¡EN LA PRÓXIMA RONDA!' },
    fr: { strength: 'MA FORCE EST À {value} !', score: '{mine} À {theirs} ! SUIS LE RYTHME !', change: 'J’AI BOUGÉ DE {value} % !', territory: 'REGARDE MON TERRITOIRE !', round: 'MANCHE {value} ! PRÊT ?', taunt: 'ESPÈCE DE BOUGIE FANÉE !', comeback: 'CE N’EST PAS FINI !', worry: 'Son graphique est costaud...', retort: 'REGARDE TA MÈCHE TORDUE !', winner: 'JE TE L’AVAIS DIT !', loser: 'JE VEUX MA REVANCHE !', draw: 'À LA PROCHAINE MANCHE !' },
    de: { strength: 'MEINE STÄRKE LIEGT BEI {value}!', score: '{mine} ZU {theirs}! HALT MIT!', change: 'MEIN KURS: {value}%!', territory: 'SIEH DIR MEIN GEBIET AN!', round: 'RUNDE {value}! BEREIT?', taunt: 'DU SCHLAPPE KERZE!', comeback: 'DAS IST NOCH NICHT VORBEI!', worry: 'Sein Chart sieht stark aus...', retort: 'SIEH DIR DEINEN KRUMMEN DOCHT AN!', winner: 'ICH HAB’S GESAGT!', loser: 'ICH WILL REVANCHE!', draw: 'IN DER NÄCHSTEN RUNDE!' },
    it: { strength: 'LA MIA FORZA È {value}!', score: '{mine} A {theirs}! STAMMI DIETRO!', change: 'VARIAZIONE: {value}%!', territory: 'GUARDA IL MIO TERRITORIO!', round: 'ROUND {value}! PRONTO?', taunt: 'CANDELA MOSCIA!', comeback: 'NON È FINITA!', worry: 'Quel grafico è forte...', retort: 'GUARDA IL TUO STOPPINO STORTO!', winner: 'TE L’AVEVO DETTO!', loser: 'VOGLIO LA RIVINCITA!', draw: 'AL PROSSIMO ROUND!' },
    ja: { strength: '強さは{value}だ！', score: '{mine}対{theirs}！追いつけるか？', change: '{value}%動いたぞ！', territory: 'この陣地を見ろ！', round: 'ラウンド{value}！準備はいいか？', taunt: 'しょんぼりローソクめ！', comeback: 'まだ終わってない！', worry: 'あのチャート、強いな…', retort: 'その曲がった芯を見ろ！', winner: '言っただろ！', loser: '再戦だ！', draw: '次のラウンドで決着だ！' },
    zh: { strength: '我的力量是{value}！', score: '{mine}比{theirs}！跟上啊！', change: '我的涨跌幅是{value}%！', territory: '看看我的地盘！', round: '第{value}回合！准备好了吗？', taunt: '你这蔫了的蜡烛！', comeback: '还没结束！', worry: '他的走势有点强……', retort: '看看你歪掉的烛芯！', winner: '我早说了！', loser: '我要再战！', draw: '下回合见真章！' },
};
const extras = {
    en: { taunt2: 'THAT CANDLE IS GOING DOWN!', retort2: 'NICE TRY, BUT NOT TODAY!', worry2: 'Did the volume spike on their side?', comeback2: 'WAIT FOR THE CANDLE TO CLOSE!', taunt: 'YOUR CHART NEEDS A NAP!', comeback: 'WAIT FOR THE NEXT ROUND!', retort: 'FIRST LEARN TO CLIMB!', worry: 'Did they see my chart?', winner: 'RESPECT THE CHAMPION!', loser: 'LUCKY SHOT...', lastWin: 'I WON THE LAST ROUND!', lastLoss: 'LAST ROUND WAS LUCK!' },
    pt: { taunt2: 'ESSE CANDLE VAI CAIR!', retort2: 'BOA TENTATIVA, MAS NÃO HOJE!', worry2: 'Será que o volume disparou do lado deles?', comeback2: 'ESPERA O CANDLE FECHAR!', taunt: 'PAVIO DE BANANA!', comeback: 'EU VOU VIRAR!', retort: 'PRIMEIRO APRENDE A SUBIR!', worry: 'Será que ele viu meu gráfico?', winner: 'RESPEITA O CAMPEÃO!', loser: 'FOI SORTE...', lastWin: 'GANHEI O ÚLTIMO ROUND!', lastLoss: 'O ÚLTIMO FOI SORTE!' },
    es: { taunt2: '¡ESA VELA VA A CAER!', retort2: '¡BUEN INTENTO, PERO NO HOY!', worry2: '¿Habrá subido el volumen de su lado?', comeback2: '¡ESPERA A QUE CIERRE LA VELA!', taunt: '¡MECHA DE PLÁTANO!', comeback: '¡VOY A REMONTAR!', retort: '¡PRIMERO APRENDE A SUBIR!', worry: '¿Habrá visto mi gráfico?', winner: '¡RESPETA AL CAMPEÓN!', loser: 'FUE SUERTE...', lastWin: '¡GANÉ LA ÚLTIMA RONDA!', lastLoss: '¡LA ÚLTIMA FUE SUERTE!' },
    fr: { taunt2: 'CETTE BOUGIE VA CHUTER !', retort2: 'BELLE TENTATIVE, PAS AUJOURD’HUI !', worry2: 'Le volume a-t-il grimpé chez eux ?', comeback2: 'ATTENDS LA CLÔTURE DE LA BOUGIE !', taunt: 'MÈCHE EN CARTON !', comeback: 'JE VAIS REMONTER !', retort: 'APPRENDS D’ABORD À MONTER !', worry: 'Il a vu mon graphique ?', winner: 'RESPECTE LE CHAMPION !', loser: 'COUP DE CHANCE...', lastWin: 'J’AI GAGNÉ LA DERNIÈRE MANCHE !', lastLoss: 'LA DERNIÈRE, C’ÉTAIT DE LA CHANCE !' },
    de: { taunt2: 'DIESE KERZE WIRD FALLEN!', retort2: 'NETTER VERSUCH, ABER NICHT HEUTE!', worry2: 'Hat ihr Volumen zugelegt?', comeback2: 'WARTE AUF DEN KERZENABSCHLUSS!', taunt: 'BANANENDOCHT!', comeback: 'ICH HOLE AUF!', retort: 'LERN ERST MAL ZU STEIGEN!', worry: 'Hat er meinen Chart gesehen?', winner: 'RESPEKT VOR DEM CHAMPION!', loser: 'NUR GLÜCK...', lastWin: 'DIE LETZTE RUNDE WAR MEINE!', lastLoss: 'DIE LETZTE WAR NUR GLÜCK!' },
    it: { taunt2: 'QUELLA CANDELA STA PER CADERE!', retort2: 'BEL TENTATIVO, MA NON OGGI!', worry2: 'Sarà salito il volume dalla loro parte?', comeback2: 'ASPETTA LA CHIUSURA DELLA CANDELA!', taunt: 'STOPPINO DI BANANA!', comeback: 'RIMONTERÒ!', retort: 'IMPARA PRIMA A SALIRE!', worry: 'Ha visto il mio grafico?', winner: 'RISPETTA IL CAMPIONE!', loser: 'SOLO FORTUNA...', lastWin: 'HO VINTO L’ULTIMO ROUND!', lastLoss: 'L’ULTIMO ERA SOLO FORTUNA!' },
    ja: { taunt2: 'そのキャンドルは落ちるぞ！', retort2: 'いい試みだったが、今日は違う！', worry2: '向こうの出来高が跳ねたのか？', comeback2: 'キャンドルが確定するまで待て！', taunt: 'バナナみたいな芯め！', comeback: '逆転してやる！', retort: 'まずは上がり方を覚えろ！', worry: 'チャートを見られたかな？', winner: '王者を敬え！', loser: '運がよかっただけだ…', lastWin: '前のラウンドは俺の勝ち！', lastLoss: '前のはまぐれだ！' },
    zh: { taunt2: '那根K线要跌了！', retort2: '好尝试，但今天不行！', worry2: '他们那边的成交量是不是放大了？', comeback2: '等这根K线收盘再说！', taunt: '香蕉烛芯！', comeback: '我会反超的！', retort: '先学会往上涨吧！', worry: '他看到我的走势图了吗？', winner: '尊重冠军！', loser: '只是运气好……', lastWin: '上一回合我赢了！', lastLoss: '上回合只是运气好！' },
};
const hash = (value) => { let h = 2166136261; for (const ch of value)
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const format = (phrase, values = {}) => phrase.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
export function dialogueLines(context, culture, slot) {
    const language = culture.slice(0, 2).toLowerCase();
    const catalog = catalogs[language] ?? catalogs.en;
    const extra = extras[language] ?? extras.en;
    const seed = hash(`${context.matchId}:${context.round}:${slot}`);
    const leader = context.score.left === context.score.right ? (seed % 2 ? 'left' : 'right') : context.score.left > context.score.right ? 'left' : 'right';
    const speaker = seed % 3 === 0 ? (leader === 'left' ? 'right' : 'left') : leader;
    const other = speaker === 'left' ? 'right' : 'left';
    const candle = context[speaker];
    const mine = context.score[speaker], theirs = context.score[other];
    const candidates = [
        { kind: 'shout', text: catalog.taunt },
        { kind: 'shout', text: extra.taunt },
        { kind: 'speech', text: format(catalog.round, { value: context.round }) },
    ];
    if (mine !== theirs)
        candidates.push({ kind: 'speech', text: mine > theirs ? format(catalog.score, { mine, theirs }) : (seed % 2 ? catalog.comeback : extra.comeback) });
    if (context.round > 1 && context.lastWinner && context.lastWinner !== 'draw')
        candidates.push({ kind: 'speech', text: context.lastWinner === speaker ? extra.lastWin : extra.lastLoss });
    if (Number.isFinite(candle?.strength))
        candidates.push({ kind: 'shout', text: format(catalog.strength, { value: candle.strength.toFixed(1) }) });
    if (candle && Number.isFinite(candleChangePercent(candle)))
        candidates.push({ kind: 'speech', text: format(catalog.change, { value: candleChangePercent(candle).toFixed(2) }) });
    if (context.score[speaker] > context.score[other] + 2)
        candidates.push({ kind: 'shout', text: catalog.territory });
    const first = candidates[(hash(`${context.matchId}:${context.round}`) + slot) % candidates.length];
    const reply = speaker === leader && mine > theirs
        ? [catalog.worry, extra.worry, catalog.comeback, extra.comeback, extra.worry2, extra.comeback2][seed % 6]
        : [catalog.retort, extra.retort, extra.retort2, extra.taunt2][seed % 4];
    return [{ side: speaker, ...first }, { side: other, kind: reply === catalog.worry || reply === extra.worry || reply === extra.worry2 ? 'thought' : 'speech', text: reply }];
}
export function finalLines(matchId, score, culture) {
    const language = culture.slice(0, 2).toLowerCase();
    const catalog = catalogs[language] ?? catalogs.en;
    const extra = extras[language] ?? extras.en;
    if (score.left === score.right)
        return [{ side: 'left', kind: 'speech', text: catalog.draw }, { side: 'right', kind: 'speech', text: catalog.retort }];
    const winner = score.left > score.right ? 'left' : 'right';
    const loser = winner === 'left' ? 'right' : 'left';
    const seed = hash(String(matchId));
    const victory = { side: winner, kind: 'shout', text: seed % 3 ? catalog.winner : extra.winner };
    const defeat = { side: loser, kind: 'thought', text: seed % 5 ? catalog.loser : extra.loser };
    return seed % 2 ? [victory, defeat] : [defeat, victory];
}
export class DialogueClock {
    constructor() {
        this.slot = 0;
        this.phase = 'wait';
        this.phaseTime = 0;
    }
    reset() { this.slot = 0; this.phase = 'wait'; this.phaseTime = 0; }
    advance(delta, matchId, round) {
        this.phaseTime += Math.max(0, delta);
        if (this.phase === 'wait' && this.phaseTime >= (this.slot === 0 ? 400 : 8000 + hash(`${matchId}:${round}:${this.slot}`) % 7001)) {
            this.phase = 'first';
            this.phaseTime = 0;
            return { slot: this.slot, line: 0 };
        }
        if (this.phase === 'first' && this.phaseTime >= 1800) {
            this.phase = 'gap';
            this.phaseTime = 0;
            return null;
        }
        if (this.phase === 'gap' && this.phaseTime >= 400) {
            this.phase = 'second';
            this.phaseTime = 0;
            return { slot: this.slot, line: 1 };
        }
        if (this.phase === 'second' && this.phaseTime >= 1800) {
            this.phase = 'wait';
            this.phaseTime = 0;
            this.slot++;
        }
        return null;
    }
    get visible() { return this.phase === 'first' || this.phase === 'second'; }
}
