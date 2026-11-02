// Market data: Binance public spot data (data-api.binance.vision) + OKX perpetual swaps.
const SPOT = 'https://data-api.binance.vision/api/v3';
const OKX = 'https://www.okx.com/api/v5';

export const SYMBOLS = {
  BTC: { spot: 'BTCUSDT', swap: 'BTC-USDT-SWAP', index: 'BTC-USDT', ccy: 'BTC', name: 'Bitcoin' },
  ETH: { spot: 'ETHUSDT', swap: 'ETH-USDT-SWAP', index: 'ETH-USDT', ccy: 'ETH', name: 'Ethereum' },
  SOL: { spot: 'SOLUSDT', swap: 'SOL-USDT-SWAP', index: 'SOL-USDT', ccy: 'SOL', name: 'Solana' },
};

// bars of history to pull per timeframe (more history = better backtests)
export const TIMEFRAMES = { '1h': 3000, '4h': 2000, '1d': 1500 };

async function getJSON(url, tries = 4) {
  let err;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'tradingterminal/1.0' } });
      if (!r.ok) throw new Error(`${r.status} ${url}: ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 800 * 2 ** a));
    }
  }
  throw err;
}

/** Spot candles, oldest first: {t,o,h,l,c,v} (t = open time ms). Drops the still-forming bar. */
export async function spotCandles(symbol, interval, total) {
  const out = [];
  let endTime;
  while (out.length < total) {
    const limit = Math.min(1000, total - out.length);
    const q = `${SPOT}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
    const rows = await getJSON(q);
    if (!rows.length) break;
    out.unshift(...rows.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], ct: k[6] })));
    endTime = rows[0][0] - 1;
    if (rows.length < limit) break;
  }
  // de-dupe and drop the forming candle
  const seen = new Set();
  const clean = out.filter((k) => (seen.has(k.t) ? false : seen.add(k.t))).sort((a, b) => a.t - b.t);
  const now = Date.now();
  const forming = clean.length && clean[clean.length - 1].ct > now ? clean.pop() : null;
  return { candles: clean.map(({ ct, ...k }) => k), forming: forming && (({ ct, ...k }) => k)(forming) };
}

export async function ticker24h(symbol) {
  const d = await getJSON(`${SPOT}/ticker/24hr?symbol=${symbol}`);
  return { last: +d.lastPrice, changePct: +d.priceChangePercent, high: +d.highPrice, low: +d.lowPrice, quoteVol: +d.quoteVolume };
}

const okx = async (path) => {
  const d = await getJSON(`${OKX}/${path}`);
  if (d.code !== '0') throw new Error(`OKX ${path}: ${d.msg}`);
  return d.data;
};

/** Perp data from OKX. Hourly series are oldest first. */
export async function futuresData(meta) {
  const [fr, frHist1, oi, oiHist, ls, taker, mark, idx, swapTk] = await Promise.all([
    okx(`public/funding-rate?instId=${meta.swap}`),
    okx(`public/funding-rate-history?instId=${meta.swap}&limit=100`),
    okx(`public/open-interest?instType=SWAP&instId=${meta.swap}`),
    okx(`rubik/stat/contracts/open-interest-volume?ccy=${meta.ccy}&period=1H`),
    okx(`rubik/stat/contracts/long-short-account-ratio?ccy=${meta.ccy}&period=1H`),
    okx(`rubik/stat/taker-volume?ccy=${meta.ccy}&instType=CONTRACTS&period=1H`),
    okx(`public/mark-price?instType=SWAP&instId=${meta.swap}`),
    okx(`market/index-tickers?instId=${meta.index}`),
    okx(`market/ticker?instId=${meta.swap}`),
  ]);
  // second page of funding history (~66 days total)
  let frHist2 = [];
  try {
    const last = frHist1[frHist1.length - 1];
    if (last) frHist2 = await okx(`public/funding-rate-history?instId=${meta.swap}&limit=100&after=${last.fundingTime}`);
  } catch { /* optional */ }
  const funding = [...frHist1, ...frHist2]
    .map((r) => ({ t: +r.fundingTime, rate: +(r.realizedRate || r.fundingRate) }))
    .sort((a, b) => a.t - b.t);
  const markPx = +mark[0].markPx, idxPx = +idx[0].idxPx;
  return {
    fundingRate: +fr[0].fundingRate,
    nextFundingTime: +fr[0].nextFundingTime || +fr[0].fundingTime,
    funding,
    openInterestUsd: +oi[0].oiUsd,
    oiHist: oiHist.map((r) => ({ t: +r[0], oi: +r[1], vol: +r[2] })).sort((a, b) => a.t - b.t),
    longShort: ls.map((r) => ({ t: +r[0], ratio: +r[1] })).sort((a, b) => a.t - b.t),
    taker: taker.map((r) => ({ t: +r[0], sell: +r[1], buy: +r[2] })).sort((a, b) => a.t - b.t),
    markPx,
    indexPx: idxPx,
    basisPct: ((markPx - idxPx) / idxPx) * 100,
    perpLast: +swapTk[0].last,
    perpVol24hUsd: +swapTk[0].volCcy24h * +swapTk[0].last,
  };
}
