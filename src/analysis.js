// Technical-analysis summary, live signal scanning and confidence scoring.
import { STRATEGIES } from './strategies.js';
import { simulate } from './backtest.js';
import { srLevels } from './levels.js';

const fin = Number.isFinite;
const sgn = (b) => (b ? 1 : -1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function biasLabel(score) {
  if (score >= 50) return 'Strong bullish';
  if (score >= 20) return 'Bullish';
  if (score > -20) return 'Neutral';
  if (score > -50) return 'Bearish';
  return 'Strong bearish';
}

/** Technical summary of the last bar of a series. */
export function technicalSummary(d, f) {
  const i = d.c.length - 1, c = d.c[i];
  const cloudTop = Math.max(d.ichi.spanA[i], d.ichi.spanB[i]), cloudBot = Math.min(d.ichi.spanA[i], d.ichi.spanB[i]);
  const trendParts = [
    { k: 'Price vs 20 EMA', v: sgn(c > d.ema20[i]) },
    { k: '20 EMA vs 50 EMA', v: sgn(d.ema20[i] > d.ema50[i]) },
    { k: '50 EMA vs 200 EMA', v: sgn(d.ema50[i] > d.ema200[i]) },
    { k: 'Price vs 200 EMA', v: sgn(c > d.ema200[i]) },
    { k: 'Supertrend', v: d.st.dir[i] },
    { k: 'Ichimoku cloud', v: c > cloudTop ? 1 : c < cloudBot ? -1 : 0 },
    { k: 'DMI (+DI vs −DI)', v: sgn(d.adx.pdi[i] > d.adx.ndi[i]) * (d.adx.adx[i] > 20 ? 1 : 0.5) },
  ];
  const trendScore = Math.round((100 * trendParts.reduce((s, x) => s + x.v, 0)) / trendParts.length);
  const roc = c / d.c[i - 10] - 1;
  const momParts = [
    { k: 'RSI 14', v: d.rsi[i] > 55 ? 1 : d.rsi[i] < 45 ? -1 : 0 },
    { k: 'MACD histogram', v: (d.macd.hist[i] > 0 ? 0.5 : -0.5) + (d.macd.hist[i] > d.macd.hist[i - 1] ? 0.5 : -0.5) },
    { k: 'MACD vs zero', v: sgn(d.macd.line[i] > 0) },
    { k: 'Stoch RSI', v: d.stoch.k[i] > d.stoch.d[i] ? 0.5 : -0.5 },
    { k: '10-bar rate of change', v: roc > 0.01 ? 1 : roc < -0.01 ? -1 : 0 },
  ];
  const momentumScore = Math.round((100 * momParts.reduce((s, x) => s + x.v, 0)) / momParts.length);
  const H = d.piv.highs.slice(-2), L = d.piv.lows.slice(-2);
  let structure = 'Mixed';
  if (H.length === 2 && L.length === 2) {
    if (H[1].price > H[0].price && L[1].price > L[0].price) structure = 'Higher highs and higher lows';
    else if (H[1].price < H[0].price && L[1].price < L[0].price) structure = 'Lower highs and lower lows';
    else if (H[1].price < H[0].price && L[1].price > L[0].price) structure = 'Contracting (triangle)';
    else structure = 'Expanding';
  }
  const adxV = d.adx.adx[i];
  const regime = adxV >= 25 ? 'Trending' : adxV < 20 ? 'Ranging' : 'Transitioning';
  const wr = d.bbWidthRank[i];
  const volatility = wr <= 15 ? 'Squeeze' : wr >= 85 ? 'Expanded' : 'Normal';
  const obvSlope = d.obv[i] - d.obv[i - 20];
  const score = Math.round(trendScore * 0.6 + momentumScore * 0.4);
  const r = d.rsi[i];
  const notes = [];
  notes.push(`${biasLabel(trendScore)} trend (${trendScore > 0 ? '+' : ''}${trendScore}), ${regime.toLowerCase()} regime (ADX ${adxV.toFixed(0)}).`);
  notes.push(r >= 70 ? `RSI ${r.toFixed(0)} is overbought; chasing longs here is risky.` : r <= 30 ? `RSI ${r.toFixed(0)} is oversold; chasing shorts here is risky.` : `RSI ${r.toFixed(0)}, ${r > 50 ? 'buyers' : 'sellers'} have the edge.`);
  if (volatility === 'Squeeze') notes.push('Bollinger bandwidth is in its bottom 15%. Expect a volatility expansion soon.');
  if (volatility === 'Expanded') notes.push('Volatility is extended. Moves are large and mean reversion is likelier.');
  notes.push(`Structure: ${structure.toLowerCase()}.`);
  if (Math.sign(obvSlope) !== Math.sign(score) && Math.abs(score) > 20) notes.push('OBV is not confirming the price direction.');
  return {
    score, bias: biasLabel(score), trendScore, momentumScore, trendParts, momParts, regime, volatility, structure, notes,
    values: {
      close: c, ema20: d.ema20[i], ema50: d.ema50[i], ema200: d.ema200[i], vwap: d.vwap[i],
      rsi: r, macd: d.macd.line[i], macdSignal: d.macd.signal[i], macdHist: d.macd.hist[i],
      adx: adxV, pdi: d.adx.pdi[i], ndi: d.adx.ndi[i],
      atr: d.atr[i], atrPct: (d.atr[i] / c) * 100,
      bbUpper: d.bb.upper[i], bbMid: d.bb.mid[i], bbLower: d.bb.lower[i], bbWidthRank: wr,
      stochK: d.stoch.k[i], stochD: d.stoch.d[i],
      supertrend: d.st.line[i], supertrendDir: d.st.dir[i],
      tenkan: d.ichi.tenkan[i], kijun: d.ichi.kijun[i], cloudTop, cloudBot,
      dcHigh: d.dcHigh[i], dcLow: d.dcLow[i],
      volRatio: d.v[i] / d.volSma[i], obvSlope20: obvSlope, roc10: roc * 100,
      funding: f?.[i]?.funding, longShort: f?.[i]?.ls, takerRatio: f?.[i]?.takerRatio,
    },
  };
}

const LOOKBACK = { '1h': 4, '4h': 3, '1d': 2 };

/** Scan the most recent bars for setups that are still live (no stop or TP2 since). */
export function liveSignals({ symbol, tf, d, f, htfScore, bt, candles }) {
  const out = [];
  const n = d.c.length - 1;
  for (const strat of STRATEGIES) {
    if (strat.futuresOnly && !f) continue;
    for (let i = n; i > n - LOOKBACK[tf]; i--) {
      let s;
      try { s = strat.fn({ d, f, tf }, i); } catch { s = null; }
      if (!s) continue;
      const sim = simulate(d, i, s, tf);
      let status = 'new';
      if (i < n) {
        if (sim.outcome === 'stop' || sim.outcome === 'tp2' || sim.outcome === 'tp1_be' || sim.outcome === 'time') break; // already resolved
        const moved = s.side === 'long' ? d.h.slice(i + 1).some((x) => x >= s.tp1) : d.l.slice(i + 1).some((x) => x <= s.tp1);
        status = moved ? 'tp1 hit' : 'active';
      }
      out.push(scoreSignal({ symbol, tf, strat, s, i, d, htfScore, bt, candles, status }));
      break; // one per strategy per timeframe (most recent)
    }
  }
  return out;
}

function scoreSignal({ symbol, tf, strat, s, i, d, htfScore, bt, candles, status }) {
  const factors = [];
  let conf = 50 + (s.quality || 0);
  if (s.quality) factors.push({ k: 'Setup quality', v: s.quality });
  const dir = s.side === 'long' ? 1 : -1;
  if (fin(htfScore)) {
    const agree = Math.sign(htfScore) === dir && Math.abs(htfScore) >= 20;
    const against = Math.sign(htfScore) === -dir && Math.abs(htfScore) >= 20;
    const v = agree ? 12 : against ? -12 : 0;
    conf += v; if (v) factors.push({ k: agree ? 'Higher timeframe agrees' : 'Against higher timeframe', v });
  }
  if (d.v[i] > 1.3 * d.volSma[i]) { conf += 4; factors.push({ k: 'Volume confirmation', v: 4 }); }
  const b = bt?.[strat.id];
  if (b && b.trades >= 8) {
    const v = b.avgR > 0.3 ? 12 : b.avgR > 0.1 ? 6 : b.avgR < -0.2 ? -15 : b.avgR < 0 ? -8 : 0;
    conf += v; if (v) factors.push({ k: `Backtest ${b.avgR >= 0 ? '+' : ''}${b.avgR.toFixed(2)}R/trade (${b.trades} trades)`, v });
  } else factors.push({ k: 'Too few backtest trades to judge', v: 0 });
  // opposing level between entry and TP1
  const lv = srLevels(d, i, { lookback: 250 }).filter((x) => x.touches >= 2);
  const block = lv.find((x) => (dir === 1 ? x.price > s.entry && x.price < s.tp1 : x.price < s.entry && x.price > s.tp1));
  if (block) { conf -= 6; factors.push({ k: `${dir === 1 ? 'Resistance' : 'Support'} at ${block.price.toFixed(2)} before TP1`, v: -6 }); }
  const rsi = d.rsi[i];
  if ((dir === 1 && rsi > 75) || (dir === -1 && rsi < 25)) { conf -= 6; factors.push({ k: 'RSI already stretched', v: -6 }); }
  const last = d.c[d.c.length - 1];
  const progressR = (dir * (last - s.entry)) / s.risk;
  if (status !== 'new' && progressR > 0.75) factors.push({ k: 'Price has moved away from entry; wait for a pullback', v: 0 });
  const stopPct = (s.risk / s.entry) * 100;
  return {
    id: `${symbol}|${tf}|${strat.id}|${candles[i].t}`,
    symbol, tf, strategy: strat.id, strategyName: strat.name, family: strat.family,
    side: s.side, markets: s.side === 'long' && !strat.futuresOnly ? ['spot', 'futures'] : ['futures'],
    time: candles[i].t, barIndex: i, status,
    entry: s.entry, stop: s.stop, tp1: s.tp1, tp2: s.tp2,
    rr1: Math.abs(s.tp1 - s.entry) / s.risk, rr2: Math.abs(s.tp2 - s.entry) / s.risk,
    stopPct, sizeAt1pct: 1 / stopPct, // position size as a multiple of account for 1% risk
    progressR, last,
    confidence: Math.round(clamp(conf, 5, 95)),
    reasons: s.reasons, factors,
    backtest: b || null,
  };
}
