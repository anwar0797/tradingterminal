#!/usr/bin/env node
// Usage: node run.js [--out out] [--history path/to/previous/reports.json]
// Fetches data, runs analysis + backtests + scanner, writes out/snapshot.json, out/reports.json, out/report.md
import fs from 'node:fs';
import path from 'node:path';
import { SYMBOLS, TIMEFRAMES, spotCandles, ticker24h, futuresData } from './src/fetch.js';
import { computeAll } from './src/indicators.js';
import { keyLevels, volumeProfile, fibLevels } from './src/levels.js';
import { STRATEGIES } from './src/strategies.js';
import { alignFutures, backtestSeries, stats, MAX_HOLD, FEE_ROUNDTRIP } from './src/backtest.js';
import { technicalSummary, liveSignals, biasLabel } from './src/analysis.js';
import { buildReport } from './src/report.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const OUT = args.out || 'out';
const CHART_BARS = 400;
const HTF = { '1h': '4h', '4h': '1d', '1d': '1d' };
const DEC = { BTC: 1, ETH: 2, SOL: 3 };

const t0 = Date.now();
const log = (...m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

function roundDeep(x, dp) {
  if (typeof x === 'number') return Number.isFinite(x) ? +x.toFixed(dp) : null;
  if (Array.isArray(x)) return x.map((y) => roundDeep(y, dp));
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 't' || k === 'time' || k.endsWith('Time') ? v : roundDeep(v, dp)]));
  return x;
}

const snap = { generatedAt: Date.now(), version: 1, sources: { spot: 'Binance spot (data-api.binance.vision)', futures: 'OKX USDT perpetual swaps' }, symbols: {}, signals: [], backtests: [], strategyStats: [] };
snap.strategies = STRATEGIES.map(({ id, name, family, desc, futuresOnly }) => ({ id, name, family, desc, futuresOnly: !!futuresOnly }));
snap.backtestModel = { feeRoundTrip: FEE_ROUNDTRIP, maxHoldBars: MAX_HOLD, exits: 'Half at TP1 then stop to breakeven, rest at TP2; stop first if both hit in one bar' };
const allTrades = {}; // strategy -> trades across symbols/tfs

for (const [sym, meta] of Object.entries(SYMBOLS)) {
  log('fetching', sym);
  const [tk, fut, ...series] = await Promise.all([
    ticker24h(meta.spot),
    futuresData(meta).catch((e) => { log('futures failed', sym, e.message); return null; }),
    ...Object.entries(TIMEFRAMES).map(([tf, n]) => spotCandles(meta.spot, tf, n)),
  ]);
  const S = { name: meta.name, price: tk.last, change24h: tk.changePct, high24h: tk.high, low24h: tk.low, quoteVol24h: tk.quoteVol, tf: {} };
  if (fut) {
    const oiNow = fut.oiHist.at(-1)?.oi, oi24 = fut.oiHist.at(-25)?.oi;
    S.futures = {
      fundingRate: fut.fundingRate, nextFundingTime: fut.nextFundingTime, fundingAnnualPct: fut.fundingRate * 3 * 365 * 100,
      openInterestUsd: fut.openInterestUsd, oiChange24h: oiNow && oi24 ? oiNow / oi24 - 1 : null,
      longShort: fut.longShort.at(-1)?.ratio, takerRatio24h: (() => { const x = fut.taker.slice(-24); const b = x.reduce((s, y) => s + y.buy, 0), s2 = x.reduce((s, y) => s + y.sell, 0); return s2 ? b / s2 : null; })(),
      markPx: fut.markPx, indexPx: fut.indexPx, basisPct: fut.basisPct, perpLast: fut.perpLast, perpVol24hUsd: fut.perpVol24hUsd,
      fundingHist: fut.funding.slice(-90).map((x) => [x.t, x.rate]),
      oiHist: fut.oiHist.filter((_, k, a) => (a.length - 1 - k) % 4 === 0).slice(-180).map((x) => [x.t, x.oi]),
      lsHist: fut.longShort.filter((_, k, a) => (a.length - 1 - k) % 4 === 0).slice(-180).map((x) => [x.t, x.ratio]),
    };
  }
  const tfNames = Object.keys(TIMEFRAMES);
  const pack = {};
  tfNames.forEach((tf, k) => {
    const { candles } = series[k];
    const d = computeAll(candles, tf);
    const f = alignFutures(candles, tf, fut);
    pack[tf] = { candles, d, f };
  });
  for (const tf of tfNames) {
    const { candles, d, f } = pack[tf];
    log(sym, tf, candles.length, 'bars; backtesting');
    const ta = technicalSummary(d, f);
    pack[tf].ta = ta;
    const bt = backtestSeries(d, f, tf);
    const btMap = {};
    const markers = [];
    const chartStart = candles.length - CHART_BARS;
    for (const r of bt) {
      const st = stats(r.trades);
      btMap[r.strategy] = st;
      snap.backtests.push({ symbol: sym, tf, strategy: r.strategy, ...st, from: candles[210]?.t, to: candles.at(-1).t });
      (allTrades[r.strategy] ||= []).push(...r.trades);
      for (const t of r.trades) if (t.i >= chartStart) markers.push({ t: candles[t.i].t, side: t.side, strategy: r.strategy, r: t.r, outcome: t.outcome });
    }
    pack[tf].bt = btMap;
    pack[tf].markers = markers;
  }
  for (const tf of tfNames) {
    const { candles, d, f, ta, bt, markers } = pack[tf];
    const htfScore = HTF[tf] === tf ? ta.score : pack[HTF[tf]].ta.score;
    const sigs = liveSignals({ symbol: sym, tf, d, f, htfScore, bt, candles });
    snap.signals.push(...sigs.map((s) => roundDeep(s, 6)));
    const last = d.c.length - 1, from = Math.max(0, d.c.length - CHART_BARS);
    const sl = (arr) => arr.slice(from);
    const dp = DEC[sym];
    S.tf[tf] = roundDeep({
      lastClose: candles[last].t,
      ta,
      levels: keyLevels(d, last, 5, { lookback: 300 }),
      majorLevels: keyLevels(d, last, 4, { lookback: 600, major: true }),
      volumeProfile: (({ bins, ...rest }) => ({ ...rest, bins: bins.map((b) => [b.price, b.vol]) }))(volumeProfile(candles, 300, 40)),
      fib: fibLevels(d, last),
      chart: {
        t: sl(candles.map((k) => k.t)), o: sl(d.o), h: sl(d.h), l: sl(d.l), c: sl(d.c), v: sl(d.v),
        ema20: sl(d.ema20), ema50: sl(d.ema50), ema200: sl(d.ema200),
        bbU: sl(d.bb.upper), bbL: sl(d.bb.lower), vwap: sl(d.vwap), st: sl(d.st.line), stDir: sl(d.st.dir),
        rsi: sl(d.rsi), macdH: sl(d.macd.hist),
      },
      markers,
    }, dp);
    if (S.tf[tf].fib) { S.tf[tf].fib.fromTime = candles[S.tf[tf].fib.fromIndex]?.t; S.tf[tf].fib.toTime = candles[S.tf[tf].fib.toIndex]?.t; }
  }
  const w = { '1d': 0.45, '4h': 0.35, '1h': 0.2 };
  S.score = Math.round(Object.entries(w).reduce((s, [tf, x]) => s + x * pack[tf].ta.score, 0));
  S.bias = biasLabel(S.score);
  const scores = Object.keys(w).map((tf) => Math.sign(pack[tf].ta.score) * (Math.abs(pack[tf].ta.score) >= 20 ? 1 : 0));
  S.alignment = scores.every((x) => x === 1) ? 'All timeframes bullish' : scores.every((x) => x === -1) ? 'All timeframes bearish' : 'Timeframes disagree';
  snap.symbols[sym] = S;
}

// aggregate strategy stats across all symbols/timeframes
const byId = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
snap.strategyStats = Object.entries(allTrades).map(([id, tr]) => ({ strategy: id, name: byId[id].name, family: byId[id].family, ...roundDeep(stats(tr), 4) }));
snap.backtests = snap.backtests.map((b) => roundDeep(b, 4));
snap.signals.sort((a, b) => b.confidence - a.confidence);

// report + history
let history = [];
if (args.history && fs.existsSync(args.history)) {
  try { history = JSON.parse(fs.readFileSync(args.history, 'utf8')); if (!Array.isArray(history)) history = history.reports || []; } catch { history = []; }
}
const prevIds = new Set(history[0]?.signalIds || []);
const rep = buildReport(snap, prevIds);
const entry = { generatedAt: snap.generatedAt, headline: rep.headline, newCount: rep.newCount, signalCount: snap.signals.length, markdown: rep.markdown, signalIds: snap.signals.map((s) => s.id) };
history = [entry, ...history.filter((h) => h.generatedAt !== entry.generatedAt)].slice(0, 60);
snap.latestReport = { generatedAt: entry.generatedAt, headline: entry.headline, markdown: entry.markdown };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(snap));
fs.writeFileSync(path.join(OUT, 'reports.json'), JSON.stringify(history));
fs.writeFileSync(path.join(OUT, 'report.md'), rep.markdown);
log(`done: ${snap.signals.length} live signals, snapshot ${(fs.statSync(path.join(OUT, 'snapshot.json')).size / 1024).toFixed(0)} KB`);
