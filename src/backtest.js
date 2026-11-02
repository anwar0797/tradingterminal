// Backtester + futures alignment.
import { STRATEGIES } from './strategies.js';
import { pctRank } from './indicators.js';

const TF_MS = { '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
export const MAX_HOLD = { '1h': 48, '4h': 30, '1d': 20 };
export const FEE_ROUNDTRIP = 0.001; // 0.1% taker fees + slippage, round trip

/**
 * Align OKX hourly derivatives series to a candle series. Returns per-bar
 * {oi, funding, fundPct, ls, lsPct, takerRatio} or null where there is no data.
 */
export function alignFutures(candles, tf, fut) {
  if (!fut || tf === '1d') return null;
  const dur = TF_MS[tf];
  const fundRates = fut.funding.map((x) => x.rate);
  const fundRank = pctRank(fundRates, Math.min(60, fundRates.length));
  const lsVals = fut.longShort.map((x) => x.ratio);
  const lsRank = pctRank(lsVals, Math.min(300, lsVals.length));
  let fi = -1, oi = -1, li = -1;
  const takerByHour = new Map(fut.taker.map((x) => [x.t, x]));
  return candles.map((k) => {
    const close = k.t + dur;
    while (fi + 1 < fut.funding.length && fut.funding[fi + 1].t <= close) fi++;
    while (oi + 1 < fut.oiHist.length && fut.oiHist[oi + 1].t < close) oi++;
    while (li + 1 < fut.longShort.length && fut.longShort[li + 1].t < close) li++;
    if (oi < 0 || fut.oiHist[oi].t < k.t) return null; // no derivatives data this far back
    let buy = 0, sell = 0;
    for (let t = k.t; t < close; t += 3600e3) { const x = takerByHour.get(t); if (x) { buy += x.buy; sell += x.sell; } }
    return {
      oi: fut.oiHist[oi].oi,
      funding: fi >= 0 ? fut.funding[fi].rate : NaN,
      fundPct: fi >= 0 ? fundRank[fi] : NaN,
      ls: li >= 0 ? fut.longShort[li].ratio : NaN,
      lsPct: li >= 0 && li >= 300 ? lsRank[li] : NaN,
      takerRatio: sell > 0 ? buy / sell : NaN,
    };
  });
}

/**
 * Simulate one setup from bar i. Model: half off at TP1 and stop to breakeven, rest at TP2,
 * time stop after MAX_HOLD bars. Same-bar stop+target ambiguity resolves to the stop (conservative).
 * Returns {r, exitIndex, outcome}.
 */
export function simulate(d, i, s, tf) {
  const long = s.side === 'long', risk = s.risk, hold = MAX_HOLD[tf];
  const fee = (s.entry * FEE_ROUNDTRIP) / risk;
  let stop = s.stop, tp1Hit = false, r = 0;
  for (let j = i + 1; j < d.c.length && j <= i + hold; j++) {
    const hi = d.h[j], lo = d.l[j];
    const stopHit = long ? lo <= stop : hi >= stop;
    if (!tp1Hit) {
      if (stopHit) return { r: -1 - fee, exitIndex: j, outcome: 'stop' };
      if (long ? hi >= s.tp1 : lo <= s.tp1) {
        tp1Hit = true; r += 0.5 * Math.abs(s.tp1 - s.entry) / risk; stop = s.entry;
        if (long ? hi >= s.tp2 : lo <= s.tp2) return { r: r + 0.5 * Math.abs(s.tp2 - s.entry) / risk - fee, exitIndex: j, outcome: 'tp2' };
        continue;
      }
    } else {
      if (stopHit) return { r: r - fee, exitIndex: j, outcome: 'tp1_be' };
      if (long ? hi >= s.tp2 : lo <= s.tp2) return { r: r + 0.5 * Math.abs(s.tp2 - s.entry) / risk - fee, exitIndex: j, outcome: 'tp2' };
    }
  }
  const last = Math.min(d.c.length - 1, i + hold);
  if (last === d.c.length - 1 && last < i + hold) return { r: null, exitIndex: null, outcome: 'open' };
  const rem = ((long ? 1 : -1) * (d.c[last] - s.entry)) / risk;
  return { r: r + (tp1Hit ? 0.5 : 1) * rem - fee, exitIndex: last, outcome: 'time' };
}

/** Run every strategy over a series. Returns stats and the per-bar signal log. */
export function backtestSeries(d, f, tf, warmup = 210) {
  const results = [];
  for (const strat of STRATEGIES) {
    if (strat.futuresOnly && !f) continue;
    const ctx = { d, f, tf };
    const trades = [];
    let busyUntil = -1;
    for (let i = warmup; i < d.c.length; i++) {
      if (i <= busyUntil) continue;
      let s;
      try { s = strat.fn(ctx, i); } catch { s = null; }
      if (!s) continue;
      const sim = simulate(d, i, s, tf);
      trades.push({ i, side: s.side, ...sim });
      if (sim.exitIndex != null) busyUntil = sim.exitIndex;
      else break;
    }
    results.push({ strategy: strat.id, trades });
  }
  return results;
}

export function stats(trades) {
  const closed = trades.filter((t) => t.r != null);
  const n = closed.length;
  if (!n) return { trades: 0, winRate: null, avgR: null, profitFactor: null, maxDD: null, totalR: 0 };
  const wins = closed.filter((t) => t.r > 0);
  const gw = wins.reduce((s, t) => s + t.r, 0), gl = -closed.filter((t) => t.r <= 0).reduce((s, t) => s + t.r, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of closed) { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return {
    trades: n,
    winRate: wins.length / n,
    avgR: eq / n,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    maxDD: dd,
    totalR: eq,
  };
}
