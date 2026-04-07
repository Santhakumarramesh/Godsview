# GodsView Pine Script Templates

TradingView Pine Script strategies that send webhook alerts to the GodsView MCP pipeline.

## Setup

1. Copy the desired Pine Script into TradingView's Pine Editor
2. Add to your chart
3. Set up alerts with webhook URL: `https://your-godsview-url/tradingview/webhook`
4. Use JSON payload format as shown in each script

## Available Scripts

| Script | Signal Type | Description |
|--------|------------|-------------|
| `breakout_strategy.pine` | breakout/breakdown | Multi-timeframe breakout with volume confirmation |
| `smc_strategy.pine` | order_block_entry, sweep_reclaim, fvg_fill | Smart Money Concepts signals |
| `divergence_strategy.pine` | divergence_bull, divergence_bear | RSI/MACD divergence detection |

## Webhook Payload Format

All scripts send JSON payloads in this format:

```json
{
  "symbol": "{{ticker}}",
  "signal": "breakout",
  "timeframe": "{{interval}}",
  "price": {{close}},
  "timestamp": {{timenow}},
  "direction": "long",
  "stop_loss": 180.50,
  "take_profit": 195.00,
  "strategy_name": "GodsView Breakout v1",
  "passphrase": "your_secret_key"
}
```

## How MCP Processes Signals

1. **Ingestion** — Validates, deduplicates, normalizes
2. **Enrichment** — Adds order book, volume delta, macro, sentiment
3. **Scoring** — Grades signal A+ through F across 6 dimensions
4. **Decision** — Approve, reject, or modify with position sizing

Signals scoring below the `minConfirmationScore` threshold are rejected.