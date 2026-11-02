// Strategy library. Each strategy is a pure function (ctx, i) -> setup | null that only
// looks at data up to bar i, so the same code drives the live scanner and the backtester.
import { srLevels, fibLevels } from './levels.js';

const fin = Number.isFinite;
const crossUp = (a, b, i) => a[i] > b[i] && a[i - 1] <= b[i - 1];
const crossDn = (a, b, i) => a[i] < b[i] && a[i - 1] >= b[i - 1];
const lastBelow = (arr, i, n) => { for (let j = i - n; j < i; j++) if (!(arr[j] <= 0)) return false; return true; };

/** Build a trade setup. tp1/tp2 default to 1.5R and 3R. */
function setup(side, entry, stop, reasons, extra = {}) {
  const risk = side === 'long' ? entry - stop : stop - entry;
  if (!(risk > 0) || !fin(risk)) return null;
  if (risk / entry > 0.12) return null; // stop too wide to be a sensible trade
  const s = side === 'long' ? 1 : -1;
  const tp1 = extra.tp1 ?? entry + s * risk * 1.5;
  const tp2 = extra.tp2 ?? entry + s * risk * 3;
  const rr1 = (s * (tp1 - entry)) / risk;
  if (!(rr1 >= 0.8)) return null; // not enough reward
  return { side, entry, stop, tp1, tp2, risk, reasons, quality: extra.quality ?? 0 };
}

const up = (d, i) => d.c[i] > d.ema200[i] && d.ema50[i] > d.ema200[i];
const dn = (d, i) => d.c[i] < d.ema200[i] && d.ema50[i] < d.ema200[i];
const volOk = (d, i, m = 1.2) => d.v[i] > m * d.volSma[i];
const bullBar = (d, i) => d.c[i] > d.o[i];
const bearBar = (d, i) => d.c[i] < d.o[i];
const swingLow = (d, i, n = 5) => Math.min(...d.l.slice(Math.max(0, i - n + 1), i + 1));
const swingHigh = (d, i, n = 5) => Math.max(...d.h.slice(Math.max(0, i - n + 1), i + 1));
const fmt = (x) => (x >= 1000 ? x.toFixed(0) : x >= 10 ? x.toFixed(2) : x.toFixed(3));
const pct = (x) => (x * 100).toFixed(2) + '%';

export const STRATEGIES = [
  // ───────────── Trend following ─────────────
  {
    id: 'ema_pullback', name: 'EMA 20 trend pullback', family: 'Trend',
    desc: 'In an established trend (50 EMA above or below the 200 EMA), price pulls back to the 20 EMA and closes back in the trend direction.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (up(d, i) && d.l[i] <= d.ema20[i] + 0.25 * a && d.c[i] > d.ema20[i] && bullBar(d, i) && d.rsi[i] > 45 && d.rsi[i] < 68)
        return setup('long', d.c[i], Math.min(swingLow(d, i, 4), d.ema50[i]) - 0.25 * a, ['Uptrend: 50 EMA > 200 EMA', 'Pulled back to the 20 EMA and closed above it', `RSI ${d.rsi[i].toFixed(0)}, not overbought`]);
      if (dn(d, i) && d.h[i] >= d.ema20[i] - 0.25 * a && d.c[i] < d.ema20[i] && bearBar(d, i) && d.rsi[i] < 55 && d.rsi[i] > 32)
        return setup('short', d.c[i], Math.max(swingHigh(d, i, 4), d.ema50[i]) + 0.25 * a, ['Downtrend: 50 EMA < 200 EMA', 'Rallied to the 20 EMA and rejected', `RSI ${d.rsi[i].toFixed(0)}`]);
      return null;
    },
  },
  {
    id: 'ema_cross', name: 'EMA 9/21 crossover', family: 'Trend',
    desc: 'Fast 9 EMA crosses the 21 EMA, taken only in the direction of the 200 EMA.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (crossUp(d.ema9, d.ema21, i) && d.c[i] > d.ema200[i]) return setup('long', d.c[i], d.c[i] - 1.5 * a, ['9 EMA crossed above 21 EMA', 'Price above the 200 EMA']);
      if (crossDn(d.ema9, d.ema21, i) && d.c[i] < d.ema200[i]) return setup('short', d.c[i], d.c[i] + 1.5 * a, ['9 EMA crossed below 21 EMA', 'Price below the 200 EMA']);
      return null;
    },
  },
  {
    id: 'golden_cross', name: 'Golden / death cross', family: 'Trend',
    desc: '50 EMA crosses the 200 EMA. Rare, slow regime-change signal.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (crossUp(d.ema50, d.ema200, i)) return setup('long', d.c[i], d.c[i] - 2.5 * a, ['Golden cross: 50 EMA crossed above 200 EMA']);
      if (crossDn(d.ema50, d.ema200, i)) return setup('short', d.c[i], d.c[i] + 2.5 * a, ['Death cross: 50 EMA crossed below 200 EMA']);
      return null;
    },
  },
  {
    id: 'supertrend', name: 'Supertrend flip', family: 'Trend',
    desc: 'Supertrend (10, 3) flips direction. The Supertrend line is the stop.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (d.st.dir[i] === 1 && d.st.dir[i - 1] === -1) return setup('long', d.c[i], Math.min(d.st.line[i], d.c[i] - 0.8 * a), ['Supertrend flipped bullish', d.adx.adx[i] > 20 ? `ADX ${d.adx.adx[i].toFixed(0)}, trend has strength` : 'Weak ADX, so expect chop'], { quality: d.adx.adx[i] > 20 ? 5 : -5 });
      if (d.st.dir[i] === -1 && d.st.dir[i - 1] === 1) return setup('short', d.c[i], Math.max(d.st.line[i], d.c[i] + 0.8 * a), ['Supertrend flipped bearish', d.adx.adx[i] > 20 ? `ADX ${d.adx.adx[i].toFixed(0)}, trend has strength` : 'Weak ADX, so expect chop'], { quality: d.adx.adx[i] > 20 ? 5 : -5 });
      return null;
    },
  },
  {
    id: 'ichimoku_tk', name: 'Ichimoku TK cross', family: 'Trend',
    desc: 'Tenkan crosses Kijun with price on the same side of the cloud.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], { tenkan, kijun, spanA, spanB } = d.ichi;
      const top = Math.max(spanA[i], spanB[i]), bot = Math.min(spanA[i], spanB[i]);
      if (!fin(top)) return null;
      if (crossUp(tenkan, kijun, i) && d.c[i] > top) return setup('long', d.c[i], Math.min(kijun[i], d.c[i] - a) - 0.3 * a, ['Tenkan crossed above Kijun', 'Price above the cloud']);
      if (crossDn(tenkan, kijun, i) && d.c[i] < bot) return setup('short', d.c[i], Math.max(kijun[i], d.c[i] + a) + 0.3 * a, ['Tenkan crossed below Kijun', 'Price below the cloud']);
      return null;
    },
  },
  {
    id: 'adx_trend', name: 'ADX trend ignition', family: 'Trend',
    desc: 'ADX rises through 25 with the directional index pointing the same way as price vs the 50 EMA.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], X = d.adx;
      if (!(X.adx[i] > 25 && X.adx[i - 1] <= 25)) return null;
      if (X.pdi[i] > X.ndi[i] && d.c[i] > d.ema50[i]) return setup('long', d.c[i], d.c[i] - 1.8 * a, [`ADX crossed 25 (${X.adx[i].toFixed(0)})`, '+DI above −DI']);
      if (X.ndi[i] > X.pdi[i] && d.c[i] < d.ema50[i]) return setup('short', d.c[i], d.c[i] + 1.8 * a, [`ADX crossed 25 (${X.adx[i].toFixed(0)})`, '−DI above +DI']);
      return null;
    },
  },
  {
    id: 'macd_cross', name: 'MACD signal cross', family: 'Momentum',
    desc: 'MACD crosses its signal line on the far side of zero, in the direction of the 200 EMA.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], m = d.macd;
      if (crossUp(m.line, m.signal, i) && m.line[i] < 0 && d.c[i] > d.ema200[i]) return setup('long', d.c[i], d.c[i] - 1.5 * a, ['MACD crossed up below zero', 'Above the 200 EMA']);
      if (crossDn(m.line, m.signal, i) && m.line[i] > 0 && d.c[i] < d.ema200[i]) return setup('short', d.c[i], d.c[i] + 1.5 * a, ['MACD crossed down above zero', 'Below the 200 EMA']);
      return null;
    },
  },
  // ───────────── Breakouts ─────────────
  {
    id: 'donchian', name: 'Donchian 20 breakout', family: 'Breakout',
    desc: 'Turtle-style: close beyond the prior 20-bar high or low on above-average volume.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (d.c[i] > d.dcHigh[i - 1] && d.c[i - 1] <= d.dcHigh[i - 2] && volOk(d, i)) return setup('long', d.c[i], d.c[i] - 2 * a, ['Closed above the 20-bar high', `Volume ${(d.v[i] / d.volSma[i]).toFixed(1)}× average`]);
      if (d.c[i] < d.dcLow[i - 1] && d.c[i - 1] >= d.dcLow[i - 2] && volOk(d, i)) return setup('short', d.c[i], d.c[i] + 2 * a, ['Closed below the 20-bar low', `Volume ${(d.v[i] / d.volSma[i]).toFixed(1)}× average`]);
      return null;
    },
  },
  {
    id: 'turtle55', name: 'Donchian 55 breakout', family: 'Breakout',
    desc: 'Slower turtle system 2: close beyond the prior 55-bar extreme.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (d.c[i] > d.dcHigh55[i - 1] && d.c[i - 1] <= d.dcHigh55[i - 2]) return setup('long', d.c[i], d.c[i] - 2 * a, ['New 55-bar closing high']);
      if (d.c[i] < d.dcLow55[i - 1] && d.c[i - 1] >= d.dcLow55[i - 2]) return setup('short', d.c[i], d.c[i] + 2 * a, ['New 55-bar closing low']);
      return null;
    },
  },
  {
    id: 'bb_squeeze', name: 'Bollinger squeeze breakout', family: 'Breakout',
    desc: 'Band width compresses into its lowest 15% (120 bars), then price closes outside a band.',
    fn(ctx, i) {
      const d = ctx.d, b = d.bb;
      const squeezed = Math.min(d.bbWidthRank[i - 1], d.bbWidthRank[i - 2], d.bbWidthRank[i - 3]) <= 15;
      if (!squeezed) return null;
      if (d.c[i] > b.upper[i]) return setup('long', d.c[i], Math.min(b.mid[i], d.c[i] - d.atr[i]), ['Volatility squeeze (bandwidth in the bottom 15%)', 'Closed above the upper band']);
      if (d.c[i] < b.lower[i]) return setup('short', d.c[i], Math.max(b.mid[i], d.c[i] + d.atr[i]), ['Volatility squeeze (bandwidth in the bottom 15%)', 'Closed below the lower band']);
      return null;
    },
  },
  {
    id: 'breakout_retest', name: 'Breakout and retest', family: 'Breakout',
    desc: 'Price broke a multi-touch S/R level, came back to retest it, and held.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const lv = srLevels(d, i - 1, { lookback: 200 }).filter((x) => x.touches >= 2);
      for (const L of lv) {
        // long: was below within last 3-12 bars, now retesting from above
        const brokeUp = d.c.slice(i - 12, i - 2).some((x) => x < L.price) && d.c.slice(i - 3, i).every((x) => x > L.price);
        if (brokeUp && d.l[i] <= L.price + 0.3 * a && d.c[i] > L.price && bullBar(d, i))
          return setup('long', d.c[i], L.price - 0.6 * a, [`Broke resistance ${fmt(L.price)} (${L.touches} touches)`, 'Retested it as support and held']);
        const brokeDn = d.c.slice(i - 12, i - 2).some((x) => x > L.price) && d.c.slice(i - 3, i).every((x) => x < L.price);
        if (brokeDn && d.h[i] >= L.price - 0.3 * a && d.c[i] < L.price && bearBar(d, i))
          return setup('short', d.c[i], L.price + 0.6 * a, [`Broke support ${fmt(L.price)} (${L.touches} touches)`, 'Retested it as resistance and rejected']);
      }
      return null;
    },
  },
  {
    id: 'volume_thrust', name: 'Volume thrust', family: 'Breakout',
    desc: 'Volume above 2.5× average on a wide-body candle that closes near its extreme.',
    fn(ctx, i) {
      const d = ctx.d, rng = d.h[i] - d.l[i];
      if (!(rng > 0) || !(d.v[i] > 2.5 * d.volSma[i]) || rng < d.atr[i]) return null;
      const body = Math.abs(d.c[i] - d.o[i]) / rng;
      if (body < 0.6) return null;
      if (bullBar(d, i) && d.h[i] - d.c[i] < 0.2 * rng) return setup('long', d.c[i], d.l[i] - 0.1 * d.atr[i], [`Volume ${(d.v[i] / d.volSma[i]).toFixed(1)}× average`, 'Strong bullish close near the high']);
      if (bearBar(d, i) && d.c[i] - d.l[i] < 0.2 * rng) return setup('short', d.c[i], d.h[i] + 0.1 * d.atr[i], [`Volume ${(d.v[i] / d.volSma[i]).toFixed(1)}× average`, 'Strong bearish close near the low']);
      return null;
    },
  },
  // ───────────── Mean reversion ─────────────
  {
    id: 'rsi_reversal', name: 'RSI 30/70 reversal', family: 'Mean reversion',
    desc: 'RSI exits oversold (or overbought) near the outer Bollinger Band. Targets the middle band.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], b = d.bb;
      if (d.rsi[i] > 30 && d.rsi[i - 1] <= 30 && d.l.slice(i - 3, i + 1).some((x) => x <= b.lower[i] + 0.2 * a))
        return setup('long', d.c[i], swingLow(d, i, 5) - 0.3 * a, ['RSI crossed back above 30', 'Tagged the lower Bollinger Band'], { tp1: b.mid[i], tp2: b.upper[i] });
      if (d.rsi[i] < 70 && d.rsi[i - 1] >= 70 && d.h.slice(i - 3, i + 1).some((x) => x >= b.upper[i] - 0.2 * a))
        return setup('short', d.c[i], swingHigh(d, i, 5) + 0.3 * a, ['RSI crossed back below 70', 'Tagged the upper Bollinger Band'], { tp1: b.mid[i], tp2: b.lower[i] });
      return null;
    },
  },
  {
    id: 'bb_reversion', name: 'Bollinger band fade', family: 'Mean reversion',
    desc: 'In a range (ADX below 22), a close outside a band followed by a close back inside. Targets the middle band.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], b = d.bb;
      if (!(d.adx.adx[i] < 22)) return null;
      if (d.c[i - 1] < b.lower[i - 1] && d.c[i] > b.lower[i]) return setup('long', d.c[i], Math.min(d.l[i], d.l[i - 1]) - 0.4 * a, ['Ranging market (ADX < 22)', 'Re-entered the bands from below'], { tp1: b.mid[i], tp2: b.upper[i] });
      if (d.c[i - 1] > b.upper[i - 1] && d.c[i] < b.upper[i]) return setup('short', d.c[i], Math.max(d.h[i], d.h[i - 1]) + 0.4 * a, ['Ranging market (ADX < 22)', 'Re-entered the bands from above'], { tp1: b.mid[i], tp2: b.lower[i] });
      return null;
    },
  },
  {
    id: 'range_sr', name: 'Range support / resistance', family: 'Mean reversion',
    desc: 'In a low-ADX range, buy a bullish rejection at strong support or sell a bearish rejection at strong resistance.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      if (!(d.adx.adx[i] < 20)) return null;
      const lv = srLevels(d, i, { lookback: 200 }).filter((x) => x.touches >= 3);
      const rng = d.h[i] - d.l[i];
      for (const L of lv) {
        const lowerWick = Math.min(d.o[i], d.c[i]) - d.l[i], upperWick = d.h[i] - Math.max(d.o[i], d.c[i]);
        if (Math.abs(d.l[i] - L.price) < 0.4 * a && d.c[i] > L.price && lowerWick > 0.4 * rng)
          return setup('long', d.c[i], L.price - 0.7 * a, [`Rejected support ${fmt(L.price)} (${L.touches} touches)`, 'Ranging market (ADX < 20)', 'Long lower wick']);
        if (Math.abs(d.h[i] - L.price) < 0.4 * a && d.c[i] < L.price && upperWick > 0.4 * rng)
          return setup('short', d.c[i], L.price + 0.7 * a, [`Rejected resistance ${fmt(L.price)} (${L.touches} touches)`, 'Ranging market (ADX < 20)', 'Long upper wick']);
      }
      return null;
    },
  },
  {
    id: 'stoch_rsi', name: 'Stoch RSI trend dip', family: 'Mean reversion',
    desc: 'Stoch RSI %K crosses %D out of the extreme zone, taken in the 200 EMA direction.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], s = d.stoch;
      if (crossUp(s.k, s.d, i) && s.k[i - 1] < 20 && up(d, i)) return setup('long', d.c[i], swingLow(d, i, 5) - 0.3 * a, ['Stoch RSI crossed up from oversold', 'Uptrend on the 200 EMA']);
      if (crossDn(s.k, s.d, i) && s.k[i - 1] > 80 && dn(d, i)) return setup('short', d.c[i], swingHigh(d, i, 5) + 0.3 * a, ['Stoch RSI crossed down from overbought', 'Downtrend on the 200 EMA']);
      return null;
    },
  },
  {
    id: 'vwap_reclaim', name: 'VWAP reclaim / reject', family: 'Mean reversion',
    desc: 'Price reclaims VWAP after 5+ bars below it (or loses it after 5+ bars above), with the trend.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const diff = (d._vdiff ??= d.c.map((x, j) => x - d.vwap[j]));
      if (diff[i] > 0 && lastBelow(diff, i, 5) && d.c[i] > d.ema50[i] * 0.995 && bullBar(d, i)) return setup('long', d.c[i], swingLow(d, i, 6) - 0.2 * a, ['Reclaimed VWAP after 5+ bars below', 'Holding near or above the 50 EMA']);
      const neg = (d._vneg ??= diff.map((x) => -x));
      if (diff[i] < 0 && lastBelow(neg, i, 5) && d.c[i] < d.ema50[i] * 1.005 && bearBar(d, i)) return setup('short', d.c[i], swingHigh(d, i, 6) + 0.2 * a, ['Lost VWAP after 5+ bars above', 'Holding near or below the 50 EMA']);
      return null;
    },
  },
  // ───────────── Reversal / price action ─────────────
  {
    id: 'rsi_divergence', name: 'RSI divergence', family: 'Reversal',
    desc: 'Price makes a lower low while RSI makes a higher low (or the bearish mirror), confirmed by the next candle.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const lows = d.piv.lows.filter((p) => p.known === i);
      if (lows.length) {
        const p2 = lows[0], prev = d.piv.lows.filter((p) => p.i < p2.i && p2.i - p.i <= 40 && p2.i - p.i >= 5).pop();
        if (prev && p2.price < prev.price && d.rsi[p2.i] > d.rsi[prev.i] + 2 && d.rsi[p2.i] < 45 && d.c[i] > d.h[p2.i] * 0.998)
          return setup('long', d.c[i], p2.price - 0.3 * a, ['Bullish RSI divergence', `Price lower low, RSI higher low (${d.rsi[prev.i].toFixed(0)} → ${d.rsi[p2.i].toFixed(0)})`]);
      }
      const highs = d.piv.highs.filter((p) => p.known === i);
      if (highs.length) {
        const p2 = highs[0], prev = d.piv.highs.filter((p) => p.i < p2.i && p2.i - p.i <= 40 && p2.i - p.i >= 5).pop();
        if (prev && p2.price > prev.price && d.rsi[p2.i] < d.rsi[prev.i] - 2 && d.rsi[p2.i] > 55 && d.c[i] < d.l[p2.i] * 1.002)
          return setup('short', d.c[i], p2.price + 0.3 * a, ['Bearish RSI divergence', `Price higher high, RSI lower high (${d.rsi[prev.i].toFixed(0)} → ${d.rsi[p2.i].toFixed(0)})`]);
      }
      return null;
    },
  },
  {
    id: 'macd_divergence', name: 'MACD histogram divergence', family: 'Reversal',
    desc: 'Price makes a new swing extreme while the MACD histogram makes a weaker one.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], hgm = d.macd.hist;
      const lows = d.piv.lows.filter((p) => p.known === i);
      if (lows.length) {
        const p2 = lows[0], prev = d.piv.lows.filter((p) => p.i < p2.i && p2.i - p.i <= 50 && p2.i - p.i >= 8).pop();
        if (prev && p2.price < prev.price && hgm[prev.i] < 0 && hgm[p2.i] > hgm[prev.i] * 0.6 && hgm[i] > hgm[i - 1])
          return setup('long', d.c[i], p2.price - 0.3 * a, ['Bullish MACD histogram divergence', 'Selling momentum fading on the new low']);
      }
      const highs = d.piv.highs.filter((p) => p.known === i);
      if (highs.length) {
        const p2 = highs[0], prev = d.piv.highs.filter((p) => p.i < p2.i && p2.i - p.i <= 50 && p2.i - p.i >= 8).pop();
        if (prev && p2.price > prev.price && hgm[prev.i] > 0 && hgm[p2.i] < hgm[prev.i] * 0.6 && hgm[i] < hgm[i - 1])
          return setup('short', d.c[i], p2.price + 0.3 * a, ['Bearish MACD histogram divergence', 'Buying momentum fading on the new high']);
      }
      return null;
    },
  },
  {
    id: 'structure_shift', name: 'Market structure shift (CHoCH)', family: 'Reversal',
    desc: 'After a run of lower highs, price closes above the last swing high (change of character), or the bearish mirror.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const H = d.piv.highs.filter((p) => p.known <= i - 1).slice(-3), L = d.piv.lows.filter((p) => p.known <= i - 1).slice(-3);
      if (H.length < 3 || L.length < 3) return null;
      const lowerHighs = H[0].price > H[1].price && H[1].price > H[2].price;
      const higherLows = L[0].price < L[1].price && L[1].price < L[2].price;
      if (lowerHighs && d.c[i] > H[2].price && d.c[i - 1] <= H[2].price) return setup('long', d.c[i], L[2].price - 0.3 * a, ['Downtrend of lower highs broken', `Closed above swing high ${fmt(H[2].price)} (CHoCH)`]);
      if (higherLows && d.c[i] < L[2].price && d.c[i - 1] >= L[2].price) return setup('short', d.c[i], H[2].price + 0.3 * a, ['Uptrend of higher lows broken', `Closed below swing low ${fmt(L[2].price)} (CHoCH)`]);
      return null;
    },
  },
  {
    id: 'bos_continuation', name: 'Break of structure (BOS)', family: 'Trend',
    desc: 'In a higher-high / higher-low structure, price closes above the latest swing high (or the bearish mirror).',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const H = d.piv.highs.filter((p) => p.known <= i - 1).slice(-2), L = d.piv.lows.filter((p) => p.known <= i - 1).slice(-2);
      if (H.length < 2 || L.length < 2) return null;
      if (H[1].price > H[0].price && L[1].price > L[0].price && d.c[i] > H[1].price && d.c[i - 1] <= H[1].price)
        return setup('long', d.c[i], L[1].price - 0.3 * a, ['Higher highs and higher lows', `Break of structure above ${fmt(H[1].price)}`]);
      if (H[1].price < H[0].price && L[1].price < L[0].price && d.c[i] < L[1].price && d.c[i - 1] >= L[1].price)
        return setup('short', d.c[i], H[1].price + 0.3 * a, ['Lower highs and lower lows', `Break of structure below ${fmt(L[1].price)}`]);
      return null;
    },
  },
  {
    id: 'liquidity_sweep', name: 'Liquidity sweep', family: 'Reversal',
    desc: 'A wick runs stops beyond a recent swing low or high, then the candle closes back inside the range.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i], rng = d.h[i] - d.l[i];
      if (!(rng > 0.8 * a)) return null;
      const L = d.piv.lows.filter((p) => p.known <= i - 1 && i - p.i <= 60).slice(-4);
      for (const p of L.reverse()) {
        if (d.l[i] < p.price && d.c[i] > p.price && d.l.slice(p.i + 1, i).every((x) => x > p.price) && (d.c[i] - d.l[i]) / rng > 0.6)
          return setup('long', d.c[i], d.l[i] - 0.2 * a, [`Swept the swing low at ${fmt(p.price)}`, 'Closed back above it (stop run)']);
      }
      const H = d.piv.highs.filter((p) => p.known <= i - 1 && i - p.i <= 60).slice(-4);
      for (const p of H.reverse()) {
        if (d.h[i] > p.price && d.c[i] < p.price && d.h.slice(p.i + 1, i).every((x) => x < p.price) && (d.h[i] - d.c[i]) / rng > 0.6)
          return setup('short', d.c[i], d.h[i] + 0.2 * a, [`Swept the swing high at ${fmt(p.price)}`, 'Closed back below it (stop run)']);
      }
      return null;
    },
  },
  {
    id: 'fib_pullback', name: 'Fibonacci golden pocket', family: 'Trend',
    desc: 'Price retraces into the 0.618–0.65 zone of the last major swing leg and closes back in the trend direction.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const f = fibLevels(d, i);
      if (!f) return null;
      const lv = Object.fromEntries(f.levels.map((x) => [x.ratio, x.price]));
      const zoneHi = Math.max(lv[0.618], lv[0.65]), zoneLo = Math.min(lv[0.618], lv[0.65]);
      if (f.direction === 'up' && d.l[i] <= zoneHi && d.c[i] >= zoneLo && bullBar(d, i) && d.c[i] > d.ema200[i])
        return setup('long', d.c[i], lv[0.786] - 0.2 * a, ['Pulled back into the 0.618–0.65 golden pocket', `Swing ${fmt(f.from)} → ${fmt(f.to)}`], { tp1: lv[0.236] > d.c[i] ? lv[0.236] : undefined, tp2: f.to + (f.to - f.from) * 0.272 });
      if (f.direction === 'down' && d.h[i] >= zoneLo && d.c[i] <= zoneHi && bearBar(d, i) && d.c[i] < d.ema200[i])
        return setup('short', d.c[i], lv[0.786] + 0.2 * a, ['Rallied into the 0.618–0.65 golden pocket', `Swing ${fmt(f.from)} → ${fmt(f.to)}`], { tp1: lv[0.236] < d.c[i] ? lv[0.236] : undefined, tp2: f.to - (f.from - f.to) * 0.272 });
      return null;
    },
  },
  {
    id: 'engulfing_level', name: 'Engulfing at key level', family: 'Reversal',
    desc: 'A bullish or bearish engulfing candle printed at a multi-touch support or resistance.',
    fn(ctx, i) {
      const d = ctx.d, a = d.atr[i];
      const bullEng = bullBar(d, i) && bearBar(d, i - 1) && d.c[i] > d.o[i - 1] && d.o[i] <= d.c[i - 1];
      const bearEng = bearBar(d, i) && bullBar(d, i - 1) && d.c[i] < d.o[i - 1] && d.o[i] >= d.c[i - 1];
      if (!bullEng && !bearEng) return null;
      const lv = srLevels(d, i - 1, { lookback: 250 }).filter((x) => x.touches >= 2);
      const lo = Math.min(d.l[i], d.l[i - 1]), hi = Math.max(d.h[i], d.h[i - 1]);
      if (bullEng) { const L = lv.find((x) => Math.abs(lo - x.price) < 0.5 * a); if (L) return setup('long', d.c[i], lo - 0.25 * a, ['Bullish engulfing candle', `At support ${fmt(L.price)} (${L.touches} touches)`]); }
      if (bearEng) { const L = lv.find((x) => Math.abs(hi - x.price) < 0.5 * a); if (L) return setup('short', d.c[i], hi + 0.25 * a, ['Bearish engulfing candle', `At resistance ${fmt(L.price)} (${L.touches} touches)`]); }
      return null;
    },
  },
  // ───────────── Futures / derivatives (perps data from OKX) ─────────────
  {
    id: 'funding_extreme', name: 'Funding rate extreme', family: 'Derivatives', futuresOnly: true,
    desc: 'Funding at a 20-day extreme means one side is crowded. Fade it once price turns against that side.',
    fn(ctx, i) {
      const d = ctx.d, f = ctx.f?.[i], a = d.atr[i];
      if (!f || !fin(f.fundPct)) return null;
      if (f.fundPct >= 95 && f.funding > 0.0002 && crossDn(d.c, d.ema9, i)) return setup('short', d.c[i], swingHigh(d, i, 6) + 0.3 * a, [`Funding ${pct(f.funding)}/8h, top 5% of the last 20 days`, 'Crowded longs; price lost the 9 EMA']);
      if (f.fundPct <= 5 && f.funding < 0 && crossUp(d.c, d.ema9, i)) return setup('long', d.c[i], swingLow(d, i, 6) - 0.3 * a, [`Funding ${pct(f.funding)}/8h, bottom 5% of the last 20 days`, 'Crowded shorts; price reclaimed the 9 EMA']);
      return null;
    },
  },
  {
    id: 'oi_divergence', name: 'Open interest divergence', family: 'Derivatives', futuresOnly: true,
    desc: 'A new high on falling OI is a weak, short-covering rally (fade it). A new low on rising OI with negative funding is short-squeeze fuel.',
    fn(ctx, i) {
      const d = ctx.d, F = ctx.f, a = d.atr[i], n = ctx.tf === '1h' ? 12 : 6;
      if (!F?.[i] || !F[i - n] || !fin(F[i].oi) || !fin(F[i - n].oi)) return null;
      const oiChg = F[i].oi / F[i - n].oi - 1;
      if (d.h[i] >= d.dcHigh[i] && oiChg < -0.03 && bearBar(d, i)) return setup('short', d.c[i], d.h[i] + 0.4 * a, ['New 20-bar high on falling open interest', `OI ${pct(oiChg)} over ${n} bars, so the rally is short covering`]);
      if (d.l[i] <= d.dcLow[i] && oiChg > 0.03 && F[i].funding < 0 && bullBar(d, i)) return setup('long', d.c[i], d.l[i] - 0.4 * a, ['New 20-bar low while OI rises', `OI +${pct(oiChg)} with negative funding: shorts piling in`]);
      return null;
    },
  },
  {
    id: 'liq_flush', name: 'Liquidation flush reversal', family: 'Derivatives', futuresOnly: true,
    desc: 'A sharp drop with a big OI wipe-out (forced selling) and oversold RSI. Buy the exhaustion, or sell the mirror squeeze.',
    fn(ctx, i) {
      const d = ctx.d, F = ctx.f, a = d.atr[i], n = ctx.tf === '1h' ? 6 : 3;
      if (!F?.[i] || !F[i - n] || !fin(F[i].oi) || !fin(F[i - n].oi)) return null;
      const oiChg = F[i].oi / F[i - n].oi - 1, px = d.c[i] / d.c[i - n] - 1;
      if (oiChg < -0.05 && px < -0.03 && d.rsi[i - 1] < 32 && bullBar(d, i)) return setup('long', d.c[i], swingLow(d, i, n + 1) - 0.3 * a, [`Price ${pct(px)} with OI ${pct(oiChg)}: long liquidations`, 'Oversold, and the first green candle printed']);
      if (oiChg < -0.05 && px > 0.03 && d.rsi[i - 1] > 70 && bearBar(d, i)) return setup('short', d.c[i], swingHigh(d, i, n + 1) + 0.3 * a, [`Price +${pct(px)} with OI ${pct(oiChg)}: short squeeze`, 'Overbought, and the first red candle printed']);
      return null;
    },
  },
  {
    id: 'ls_extreme', name: 'Long/short ratio extreme', family: 'Derivatives', futuresOnly: true,
    desc: 'The retail long/short account ratio sits at a 30-day extreme. Trade against the crowd once price confirms.',
    fn(ctx, i) {
      const d = ctx.d, f = ctx.f?.[i], a = d.atr[i];
      if (!f || !fin(f.lsPct)) return null;
      if (f.lsPct >= 95 && crossDn(d.c, d.ema21, i)) return setup('short', d.c[i], swingHigh(d, i, 6) + 0.3 * a, [`Long/short ratio ${f.ls.toFixed(2)}, top 5% of 30 days`, 'Price lost the 21 EMA']);
      if (f.lsPct <= 5 && crossUp(d.c, d.ema21, i)) return setup('long', d.c[i], swingLow(d, i, 6) - 0.3 * a, [`Long/short ratio ${f.ls.toFixed(2)}, bottom 5% of 30 days`, 'Price reclaimed the 21 EMA']);
      return null;
    },
  },
  {
    id: 'taker_flow', name: 'Aggressive taker flow breakout', family: 'Derivatives', futuresOnly: true,
    desc: 'Perp taker buy/sell volume is heavily one-sided while price breaks the 20-bar range in the same direction.',
    fn(ctx, i) {
      const d = ctx.d, f = ctx.f?.[i], a = d.atr[i];
      if (!f || !fin(f.takerRatio)) return null;
      if (f.takerRatio >= 1.25 && d.c[i] > d.dcHigh[i - 1]) return setup('long', d.c[i], d.c[i] - 1.8 * a, [`Taker buy/sell ${f.takerRatio.toFixed(2)}: aggressive buyers`, 'Broke the 20-bar high']);
      if (f.takerRatio <= 0.8 && d.c[i] < d.dcLow[i - 1]) return setup('short', d.c[i], d.c[i] + 1.8 * a, [`Taker buy/sell ${f.takerRatio.toFixed(2)}: aggressive sellers`, 'Broke the 20-bar low']);
      return null;
    },
  },
];

export const FAMILIES = [...new Set(STRATEGIES.map((s) => s.family))];
