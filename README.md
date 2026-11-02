# Trading Terminal

Technical analysis and trade ideas for **BTC, ETH and SOL**, for day and swing trading on 1H / 4H / 1D, spot and perpetual futures.

- **Dashboard**: candlestick charts with EMAs, Bollinger Bands, VWAP, Supertrend, S/R levels, Fibonacci, signal markers, RSI pane, futures panel
- **Signals**: 29 strategies (trend, momentum, breakout, mean reversion, reversal/price action, derivatives) with filters for coin, timeframe, market, direction, family, strategy, confidence and backtest quality
- **Technical analysis**: per-timeframe bias, indicator readings, components, S/R, Fibonacci, volume profile, funding / OI / long-short history
- **Backtests**: per-strategy win rate, expectancy (R), profit factor and drawdown on every coin and timeframe, after fees
- **Reports**: 4-hourly report, also emailed

Data: Binance spot public market data and OKX perpetual swaps. No API keys needed.

```bash
NODE_USE_ENV_PROXY=1 node run.js   # NODE_USE_ENV_PROXY only needed behind an HTTP proxy
```

Outputs `out/snapshot.json`, `out/reports.json` and `out/report.md`. Serve `web/index.html` next to the two JSON files to view the dashboard locally.

Educational analysis, not financial advice.
