// Minimal stub of the CriptoVersus API endpoints used by the Candle Battle
// social capture page. Serves deterministic fixture matches for the local
// Playwright validation in social-capture-validate.mjs. No secrets, no writes.
import http from 'node:http';

const PERIOD = 300_000;
const SYMBOL_A = 'RUNEUSDT';
const SYMBOL_B = 'STRKUSDT';

function candle(symbol, openTime, seed, up) {
  const open = 100 + (seed % 7) * 3;
  const close = up ? open * 1.012 : open * 0.988;
  return {
    symbol, openTime, closeTime: openTime + PERIOD, updatedAt: openTime + PERIOD,
    open: Number(open.toFixed(4)), high: Number((Math.max(open, close) * 1.006).toFixed(4)),
    low: Number((Math.min(open, close) * 0.994).toFixed(4)), close: Number(close.toFixed(4)),
    volume: 1200 + seed * 17, confirmed: true, strength: up ? 64 : 38
  };
}

function buildRound(matchId, index, startMs) {
  const openTime = startMs + index * PERIOD;
  const leftUp = index % 3 !== 2;
  return {
    id: `${matchId}:5m:${openTime}`, matchId,
    left: candle(SYMBOL_A, openTime, index, leftUp),
    right: candle(SYMBOL_B, openTime, index + 5, !leftUp),
    winner: leftUp ? 'left' : 'right',
    ruleVersion: '2026-02', leftStrength: leftUp ? 71 : 34, rightStrength: leftUp ? 34 : 71
  };
}

const scenario = id => {
  const finished = id === 91;
  const count = finished ? 18 : 14;
  const startMs = Math.floor(Date.now() / PERIOD) * PERIOD - (count + 1) * PERIOD;
  const rounds = Array.from({ length: count }, (_, i) => buildRound(id, i, startMs));
  return { id, finished, count, startMs, rounds, scoreA: rounds.filter(r => r.winner === 'left').length, scoreB: rounds.filter(r => r.winner === 'right').length };
};

const scenarios = new Map([[90, scenario(90)], [91, scenario(91)]]);
const resolve = id => scenarios.get(id) ?? scenario(id);

const asset = symbol => {
  const base = symbol.replace(/USDT$/i, '');
  return { symbol, pair: `${base}/USDT`, logoUrl: `/futurebol/team-logo/${encodeURIComponent(symbol)}`,
    openingPrice: 100, closingPrice: 101.2, performancePercent: 1.2, greenCandles: 8, redCandles: 6 };
};

function socialResponse(s) {
  return {
    category: 'candle_battle_highlight', matchId: s.id, battleId: `${s.id}:5m`, battleType: 'candle_battles_arcade',
    status: s.finished ? 'Completed' : 'Live', battleStatus: s.finished ? 'finished' : 'live',
    startTimeUtc: new Date(s.startMs).toISOString(),
    endTimeUtc: s.finished ? new Date(s.startMs + 18 * PERIOD).toISOString() : null,
    durationMinutes: s.finished ? 90 : 70,
    assetA: asset(SYMBOL_A), assetB: asset(SYMBOL_B),
    scoreA: s.scoreA, scoreB: s.scoreB,
    winnerSymbol: s.finished ? (s.scoreA === s.scoreB ? null : s.scoreA > s.scoreB ? SYMBOL_A : SYMBOL_B) : null,
    confrontationCount: s.count, expectedConfrontations: 18, interestScore: 82,
    selectionReasons: ['balanced_score'], rounds: s.rounds,
    replayAvailable: true, replayUnavailableReason: null,
    canPost: false, skipReason: 'already_published', alreadyPublished: true,
    publication: null, publicUrl: null, publicUrlAvailable: false,
    generatedAtUtc: new Date().toISOString()
  };
}

function feed(s) {
  return {
    matchId: s.id, leftSymbol: SYMBOL_A, rightSymbol: SYMBOL_B,
    scoreLeft: s.scoreA, scoreRight: s.scoreB,
    finished: s.finished, status: s.finished ? 'finished' : 'live',
    left: null, right: null, rounds: s.rounds, hasMore: false, nextCursor: null,
    matchStartTime: s.startMs, matchEndTime: s.finished ? s.startMs + 18 * PERIOD : null,
    expectedRounds: 18, serverTime: Date.now()
  };
}

const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const LOGO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+9N9sAAAAASUVORK5CYII=', 'base64');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const social = /^\/api\/social\/candle-battle\/(\d+)/.exec(url.pathname);
  const battles = /^\/api\/matches\/(\d+)\/candle-battles/.exec(url.pathname);
  const icon = /^\/api\/icons\/binance\/([A-Za-z0-9]+)/.exec(url.pathname);
  if (icon) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(LOGO_PNG);
  }
  const match = social ? Number(social[1]) : battles ? Number(battles[1]) : 0;
  const s = resolve(match);
  if (social) return json(res, socialResponse(s));
  if (battles) return json(res, feed(s));
  res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
});

const port = Number(process.env.PORT ?? 5175);
server.listen(port, '127.0.0.1', () => console.log(`candle battle capture stub api on http://127.0.0.1:${port}`));
