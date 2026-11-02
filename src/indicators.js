// Indicator library. Every function returns arrays aligned to the input (NaN until warmed up).
// Values at index i only use data up to and including bar i (no look-ahead).
const N = NaN;
const fin = Number.isFinite;

export function sma(src, n) {
  const out = new Array(src.length).fill(N);
  let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!fin(x)) { sum = 0; cnt = 0; continue; }
    sum += x; cnt++;
    if (cnt > n) { sum -= src[i - n]; cnt = n; }
    if (cnt === n) out[i] = sum / n;
  }
  return out;
}

export function ema(src, n) {
  const out = new Array(src.length).fill(N);
  const k = 2 / (n + 1);
  let prev = N, seed = [], started = false;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!fin(x)) continue;
    if (!started) {
      seed.push(x);
      if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; started = true; }
      continue;
    }
    prev = x * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder smoothing */
export function rma(src, n) {
  const out = new Array(src.length).fill(N);
  let prev = N, seed = [], started = false;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!fin(x)) continue;
    if (!started) {
      seed.push(x);
      if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; started = true; }
      continue;
    }
    prev = (prev * (n - 1) + x) / n;
    out[i] = prev;
  }
  return out;
}

export function stdev(src, n) {
  const out = new Array(src.length).fill(N);
  for (let i = n - 1; i < src.length; i++) {
    let s = 0, s2 = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { const x = src[j]; if (!fin(x)) { ok = false; break; } s += x; s2 += x * x; }
    if (!ok) continue;
    const m = s / n;
    out[i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  return out;
}

export function highest(src, n) {
  const out = new Array(src.length).fill(N);
  for (let i = n - 1; i < src.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (src[j] > m) m = src[j]; out[i] = m; }
  return out;
}
export function lowest(src, n) {
  const out = new Array(src.length).fill(N);
  for (let i = n - 1; i < src.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (src[j] < m) m = src[j]; out[i] = m; }
  return out;
}

export function rsi(close, n = 14) {
  const up = [N], dn = [N];
  for (let i = 1; i < close.length; i++) { const d = close[i] - close[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const au = rma(up, n), ad = rma(dn, n);
  return au.map((u, i) => (fin(u) && fin(ad[i]) ? (ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])) : N));
}

export function macd(close, f = 12, s = 26, sig = 9) {
  const ef = ema(close, f), es = ema(close, s);
  const line = ef.map((x, i) => x - es[i]);
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

export function trueRange(h, l, c) {
  return h.map((x, i) => (i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}
export const atr = (h, l, c, n = 14) => rma(trueRange(h, l, c), n);

export function bollinger(close, n = 20, k = 2) {
  const mid = sma(close, n), sd = stdev(close, n);
  const upper = mid.map((m, i) => m + k * sd[i]), lower = mid.map((m, i) => m - k * sd[i]);
  const width = mid.map((m, i) => (upper[i] - lower[i]) / m);
  return { mid, upper, lower, width };
}

export function adx(h, l, c, n = 14) {
  const pdm = [N], ndm = [N];
  for (let i = 1; i < h.length; i++) {
    const u = h[i] - h[i - 1], d = l[i - 1] - l[i];
    pdm.push(u > d && u > 0 ? u : 0); ndm.push(d > u && d > 0 ? d : 0);
  }
  const tr = trueRange(h, l, c); tr[0] = N;
  const str = rma(tr, n), sp = rma(pdm, n), sn = rma(ndm, n);
  const pdi = sp.map((x, i) => (100 * x) / str[i]), ndi = sn.map((x, i) => (100 * x) / str[i]);
  const dx = pdi.map((p, i) => (p + ndi[i] === 0 ? 0 : (100 * Math.abs(p - ndi[i])) / (p + ndi[i])));
  return { adx: rma(dx, n), pdi, ndi };
}

export function supertrend(h, l, c, n = 10, m = 3) {
  const a = atr(h, l, c, n);
  const len = c.length, line = new Array(len).fill(N), dir = new Array(len).fill(0);
  let fu = N, fl = N, d = 1;
  for (let i = 0; i < len; i++) {
    if (!fin(a[i])) continue;
    const hl2 = (h[i] + l[i]) / 2, ub = hl2 + m * a[i], lb = hl2 - m * a[i];
    if (!fin(fu)) { fu = ub; fl = lb; }
    else {
      fu = ub < fu || c[i - 1] > fu ? ub : fu;
      fl = lb > fl || c[i - 1] < fl ? lb : fl;
    }
    if (d === 1 && c[i] < fl) d = -1;
    else if (d === -1 && c[i] > fu) d = 1;
    dir[i] = d; line[i] = d === 1 ? fl : fu;
  }
  return { line, dir };
}

export function ichimoku(h, l, t = 9, k = 26, b = 52, shift = 26) {
  const mid = (n) => { const hh = highest(h, n), ll = lowest(l, n); return hh.map((x, i) => (x + ll[i]) / 2); };
  const tenkan = mid(t), kijun = mid(k), sb = mid(b);
  const sa = tenkan.map((x, i) => (x + kijun[i]) / 2);
  // cloud plotted at bar i was computed `shift` bars ago
  const spanA = sa.map((_, i) => (i >= shift ? sa[i - shift] : N));
  const spanB = sb.map((_, i) => (i >= shift ? sb[i - shift] : N));
  return { tenkan, kijun, spanA, spanB };
}

/** VWAP anchored by period ('day' | 'week') or rolling over n bars when anchor is a number. */
export function vwap(candles, anchor) {
  const out = new Array(candles.length).fill(N);
  if (typeof anchor === 'number') {
    for (let i = anchor - 1; i < candles.length; i++) {
      let pv = 0, v = 0;
      for (let j = i - anchor + 1; j <= i; j++) { const k = candles[j]; pv += ((k.h + k.l + k.c) / 3) * k.v; v += k.v; }
      out[i] = v ? pv / v : N;
    }
    return out;
  }
  const key = (t) => (anchor === 'week' ? Math.floor((t / 86400000 + 3) / 7) : Math.floor(t / 86400000)); // weeks start Monday
  let pv = 0, v = 0, cur = null;
  candles.forEach((k, i) => {
    const kk = key(k.t);
    if (kk !== cur) { cur = kk; pv = 0; v = 0; }
    pv += ((k.h + k.l + k.c) / 3) * k.v; v += k.v;
    out[i] = v ? pv / v : N;
  });
  return out;
}

export function obv(c, v) {
  const out = [0];
  for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
  return out;
}

export function stochRsi(close, n = 14, k = 3, d = 3) {
  const r = rsi(close, n);
  const hh = highest(r, n), ll = lowest(r, n);
  const raw = r.map((x, i) => (hh[i] - ll[i] === 0 ? 50 : (100 * (x - ll[i])) / (hh[i] - ll[i])));
  const K = sma(raw, k);
  return { k: K, d: sma(K, d) };
}

/** Percentile rank of src[i] within the trailing n values (0..100). */
export function pctRank(src, n) {
  const out = new Array(src.length).fill(N);
  for (let i = n - 1; i < src.length; i++) {
    if (!fin(src[i])) continue;
    let below = 0, tot = 0;
    for (let j = i - n + 1; j <= i; j++) if (fin(src[j])) { tot++; if (src[j] < src[i]) below++; }
    out[i] = tot ? (100 * below) / tot : N;
  }
  return out;
}

/**
 * Swing pivots. A pivot at bar j is only *known* at bar j + right (confirmation),
 * stored as `known` so strategies can avoid look-ahead.
 */
export function pivots(h, l, left = 3, right = 3) {
  const highs = [], lows = [];
  for (let j = left; j < h.length - right; j++) {
    let isH = true, isL = true;
    for (let k = j - left; k <= j + right; k++) {
      if (k === j) continue;
      if (h[k] >= h[j] && (k > j || h[k] > h[j])) isH = false;
      if (l[k] <= l[j] && (k > j || l[k] < l[j])) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push({ i: j, price: h[j], known: j + right });
    if (isL) lows.push({ i: j, price: l[j], known: j + right });
  }
  return { highs, lows };
}

/** Compute the full indicator pack for a candle series. */
export function computeAll(candles, tf) {
  const o = candles.map((k) => k.o), h = candles.map((k) => k.h), l = candles.map((k) => k.l), c = candles.map((k) => k.c), v = candles.map((k) => k.v);
  const bb = bollinger(c, 20, 2);
  return {
    o, h, l, c, v,
    ema9: ema(c, 9), ema20: ema(c, 20), ema21: ema(c, 21), ema50: ema(c, 50), ema200: ema(c, 200),
    rsi: rsi(c, 14),
    macd: macd(c),
    atr: atr(h, l, c, 14),
    bb, bbWidthRank: pctRank(bb.width, 120),
    adx: adx(h, l, c, 14),
    st: supertrend(h, l, c, 10, 3),
    ichi: ichimoku(h, l),
    dcHigh: highest(h, 20), dcLow: lowest(l, 20), dcHigh55: highest(h, 55), dcLow55: lowest(l, 55),
    vwap: vwap(candles, tf === '1h' ? 'day' : tf === '4h' ? 'week' : 20),
    obv: obv(c, v),
    stoch: stochRsi(c),
    volSma: sma(v, 20),
    piv: pivots(h, l, 3, 3),
    pivMajor: pivots(h, l, 8, 8),
  };
}
