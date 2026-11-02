# Trading Terminal: runbook for Claude sessions

Dashboard artifact: https://claude.ai/artifact/1U4PVgfrNQ4eBsWuwfS7EG
It serves `web/index.html` plus two data files published next to it: `snapshot.json` and `reports.json`.

## 4-hourly update (scheduled task)

1. Clone if needed: `git clone --depth 1 https://github.com/anwar0797/tradingterminal ~/tradingterminal`
2. Fetch the previous report history: Artifact `read` with `url` = the dashboard URL and `path` = `reports.json`. Note the local path it was saved to.
3. Run the engine (Node 18+, no dependencies). Node's fetch needs the proxy flag in Claude cloud sessions:
   `cd ~/tradingterminal && NODE_USE_ENV_PROXY=1 DASHBOARD_URL=https://claude.ai/artifact/1U4PVgfrNQ4eBsWuwfS7EG node run.js --history <saved reports.json> --out out`
4. Artifact `list` with `scope: "files"` on the dashboard URL, then Artifact publish with
   `url` = dashboard URL, `file_path` = `~/tradingterminal/web/index.html`,
   `files` = `{"snapshot.json": "~/tradingterminal/out/snapshot.json", "reports.json": "~/tradingterminal/out/reports.json"}` (absolute paths).
5. End with the full text of `out/report.md` as the final message. It is the report that gets emailed.

If the data fetch fails, do not publish. Say which host failed (network policy needs: data-api.binance.vision, www.okx.com).

## Layout

- `src/fetch.js`: Binance spot candles (1h/4h/1d) + OKX perp data (funding, OI, long/short, taker flow, basis)
- `src/indicators.js`: EMA/SMA/RSI/MACD/ATR/Bollinger/ADX/Supertrend/Ichimoku/VWAP/OBV/Stoch RSI/pivots
- `src/levels.js`: S/R clustering, volume profile, Fibonacci
- `src/strategies.js`: 29 strategies, `fn(ctx, i)` with no look-ahead. Shared by the scanner and the backtester
- `src/backtest.js`: trade simulator (half at TP1 + breakeven, rest at TP2, time stop, 0.1% fees)
- `src/analysis.js`: TA summary, live signal scan, confidence scoring
- `src/report.js`: markdown report
- `web/index.html`: the dashboard page (Lightweight Charts from unpkg)

Adding a strategy: append an object to `STRATEGIES` in `src/strategies.js` and return `setup(side, entry, stop, reasons, {tp1?, tp2?})`.
