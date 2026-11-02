// Support / resistance, volume profile and Fibonacci levels.
const fin = Number.isFinite;

/** Cluster swing pivots known at bar i into S/R levels. */
export function srLevels(ind, i, { lookback = 250, major = false } = {}) {
  const piv = major ? ind.pivMajor : ind.piv;
  const atr = ind.atr[i];
  if (!fin(atr)) return [];
  const tol = atr * (major ? 0.9 : 0.6);
  const pts = [];
  for (const p of piv.highs) if (p.known <= i && i - p.i <= lookback) pts.push({ price: p.price, i: p.i, kind: 'H' });
  for (const p of piv.lows) if (p.known <= i && i - p.i <= lookback) pts.push({ price: p.price, i: p.i, kind: 'L' });
  pts.sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of pts) {
    const last = clusters[clusters.length - 1];
    if (last && p.price - last.max <= tol) { last.pts.push(p); last.max = p.price; }
    else clusters.push({ pts: [p], max: p.price });
  }
  const close = ind.c[i];
  return clusters.map((cl) => {
    const price = cl.pts.reduce((s, p) => s + p.price, 0) / cl.pts.length;
    const lastTouch = Math.max(...cl.pts.map((p) => p.i));
    const recency = 1 - Math.min(1, (i - lastTouch) / lookback);
    return {
      price,
      touches: cl.pts.length,
      strength: Math.round(Math.min(100, cl.pts.length * 22 + recency * 30)),
      type: price >= close ? 'resistance' : 'support',
      lastTouch,
    };
  });
}

/** Nearest n supports below and resistances above the close. */
export function keyLevels(ind, i, n = 4, opts) {
  const lv = srLevels(ind, i, opts).filter((x) => x.touches >= 2 || x.strength >= 40);
  const c = ind.c[i];
  const sup = lv.filter((x) => x.price < c).sort((a, b) => b.price - a.price).slice(0, n);
  const res = lv.filter((x) => x.price >= c).sort((a, b) => a.price - b.price).slice(0, n);
  return { support: sup, resistance: res };
}

/** Volume profile over the last `bars` candles. */
export function volumeProfile(candles, bars = 300, bins = 48) {
  const cs = candles.slice(-bars);
  const lo = Math.min(...cs.map((k) => k.l)), hi = Math.max(...cs.map((k) => k.h));
  const step = (hi - lo) / bins || 1;
  const vol = new Array(bins).fill(0);
  for (const k of cs) {
    const a = Math.max(0, Math.floor((k.l - lo) / step)), b = Math.min(bins - 1, Math.floor((k.h - lo) / step));
    const share = k.v / (b - a + 1);
    for (let j = a; j <= b; j++) vol[j] += share;
  }
  const total = vol.reduce((s, x) => s + x, 0);
  let poc = vol.indexOf(Math.max(...vol));
  // value area: expand around POC until 70% of volume
  let lo_i = poc, hi_i = poc, acc = vol[poc];
  while (acc < total * 0.7 && (lo_i > 0 || hi_i < bins - 1)) {
    const dn = lo_i > 0 ? vol[lo_i - 1] : -1, up = hi_i < bins - 1 ? vol[hi_i + 1] : -1;
    if (up >= dn) acc += vol[++hi_i]; else acc += vol[--lo_i];
  }
  const mid = (j) => lo + (j + 0.5) * step;
  return {
    poc: mid(poc), vah: lo + (hi_i + 1) * step, val: lo + lo_i * step,
    bins: vol.map((v, j) => ({ price: mid(j), vol: v })),
  };
}

/** Fibonacci retracement of the last major swing leg known at bar i. */
export function fibLevels(ind, i) {
  const highs = ind.pivMajor.highs.filter((p) => p.known <= i);
  const lows = ind.pivMajor.lows.filter((p) => p.known <= i);
  if (!highs.length || !lows.length) return null;
  const H = highs[highs.length - 1], L = lows[lows.length - 1];
  const up = L.i < H.i; // leg direction: low then high = up leg
  const range = H.price - L.price;
  if (range <= 0) return null;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.65, 0.786, 1];
  return {
    direction: up ? 'up' : 'down',
    from: up ? L.price : H.price, to: up ? H.price : L.price,
    fromIndex: up ? L.i : H.i, toIndex: up ? H.i : L.i,
    levels: ratios.map((r) => ({ ratio: r, price: up ? H.price - range * r : L.price + range * r })),
  };
}
