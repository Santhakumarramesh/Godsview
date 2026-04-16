# TradingView Webhook Integration

## Overview

The GodsView trading system now includes a **real TradingView webhook integration** with:
- **Webhook receiver** that accepts Pine script alerts
- **Deduplication** (60-second window) to prevent duplicate signals
- **Bidirectional sync** that pushes chart annotations back to TradingView via Chrome extension
- **Signal persistence** (circular buffer of last 500 signals)
- **Comprehensive statistics** and audit trails

---

## Architecture

### 1. TradingView → GodsView (Inbound)

```
TradingView Chart Alert
    ↓
Pine Script Webhook
    ↓
POST /api/tv-webhook
    ↓
Authentication (Bearer Token)
    ↓
Payload Validation
    ↓
Deduplication Check (hash: symbol+action+timeframe+minute)
    ↓
Convert to Internal Signal
    ↓
Store in Circular Buffer (500 signals)
    ↓
Broadcast to WebSocket Clients
    ↓
Push to Signal Queue (/api/v2/signals)
```

### 2. GodsView → TradingView (Outbound)

```
Internal Signal
    ↓
Build Chart Annotations (entry/SL/TP lines, confidence labels)
    ↓
Store in Annotation Buffer (by symbol)
    ↓
Chrome Extension Polls /api/tv-sync/:symbol/annotations
    ↓
Extension Renders on Chart
    ↓
Extension Confirms Receipt → POST /api/tv-sync/:symbol/annotations/ack
```

---

## Setup

### Step 1: Configure Environment

Add to your `.env` file:

```bash
# TradingView webhook authentication secret
TV_WEBHOOK_SECRET=your_super_secure_webhook_secret_here

# Optional: custom signal queue endpoint (defaults to http://localhost:3000/api)
GODSVIEW_API_URL=https://your-godsview-domain.com/api
```

### Step 2: Deploy Pine Script

1. Open TradingView's Pine Script Editor
2. Create a new strategy or use the provided `docs/pine_scripts/smc_strategy.pine`
3. In the strategy alert conditions, configure the webhook URL:

```
https://your-godsview-domain.com/api/tv-webhook
```

4. Add the authorization header in the alert settings:

```
Authorization: Bearer your_super_secure_webhook_secret_here
```

### Step 3: Create Alert

1. Go to the chart with the strategy applied
2. Click the Alert Bell icon
3. Create new alert with these settings:
   - **Condition**: Your strategy name + signal type
   - **Webhook URL**: `https://your-godsview-domain.com/api/tv-webhook`
   - **Message**: Use the JSON format below

### Step 4: Install Chrome Extension

The GodsView Chrome extension periodically polls for annotations and renders them on TradingView charts.

---

## Webhook Payload Format

### JSON Alert Structure

TradingView Pine scripts should POST JSON in this format:

```json
{
  "symbol": "AAPL",
  "signal": "order_block_entry",
  "timeframe": "5m",
  "price": 150.25,
  "timestamp": 1640000000000,
  "direction": "long",
  "stop_loss": 149.50,
  "take_profit": 152.00,
  "strategy_name": "GodsView SMC v1",
  "passphrase": "your_secret_key"
}
```

### Pine Script Alert Message

In TradingView alerts, use this format (replace placeholders with actual values):

```json
{
  "symbol": "{{ticker}}",
  "signal": "order_block_entry",
  "timeframe": "{{interval}}",
  "price": {{close}},
  "timestamp": {{timenow}},
  "direction": "long",
  "stop_loss": 149.50,
  "take_profit": 152.00,
  "strategy_name": "GodsView SMC v1"
}
```

### Supported Signal Types

- `order_block_entry` — Smart Money order block hit
- `sweep_reclaim` — Liquidity sweep + reclaim pattern
- `fvg_fill` — Fair Value Gap filled
- `cvd_divergence` — Cumulative Volume Delta divergence
- `absorption_reversal` — Volume absorption reversal
- `breakout_failure` — Breakout reject pattern

---

## API Endpoints

### POST /api/tv-webhook

**Receive TradingView alerts**

Headers:
```
Authorization: Bearer YOUR_TV_WEBHOOK_SECRET
Content-Type: application/json
```

Request Body:
```json
{
  "symbol": "AAPL",
  "signal": "order_block_entry",
  "timeframe": "5m",
  "price": 150.25,
  "timestamp": 1640000000000,
  "direction": "long",
  "stop_loss": 149.50,
  "take_profit": 152.00,
  "strategy_name": "GodsView SMC v1"
}
```

Response (Success):
```json
{
  "ok": true,
  "received": true,
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "deduplicated": false
}
```

Response (Duplicate):
```json
{
  "ok": true,
  "received": true,
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "deduplicated": true
}
```

### GET /api/tv-webhook/history

**Retrieve recent signals**

Query Parameters:
- `limit` (optional): number of signals to return (default 50, max 500)
- `symbol` (optional): filter by symbol (e.g., AAPL, SPY)

Example:
```
GET /api/tv-webhook/history?limit=100&symbol=AAPL
```

Response:
```json
{
  "ok": true,
  "count": 42,
  "signals": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "symbol": "AAPL",
      "action": "order_block_entry",
      "timeframe": "5m",
      "entry_price": 150.25,
      "stop_loss": 149.50,
      "take_profit": 152.00,
      "direction": "long",
      "setup_type": "order_block_entry",
      "confidence": 0.75,
      "source": "tradingview",
      "strategy_name": "GodsView SMC v1",
      "timestamp": 1640000000000
    }
  ]
}
```

### GET /api/tv-webhook/stats

**Webhook statistics**

Response:
```json
{
  "ok": true,
  "stats": {
    "total_received": 1234,
    "total_deduplicated": 156,
    "total_errors": 3,
    "last_signal_time": 1640000000000,
    "last_error": "Invalid entry price",
    "last_error_time": 1640000000000,
    "buffer_size": 487
  }
}
```

---

## Bidirectional Sync API

### GET /api/tv-sync/:symbol/annotations

**Chrome extension polls for pending annotations**

Query Parameters:
- `include_acknowledged` (optional): include already-delivered annotations (default false)
- `timeframe` (optional): filter by timeframe

Example:
```
GET /api/tv-sync/AAPL/annotations?timeframe=5m
```

Response:
```json
{
  "ok": true,
  "symbol": "AAPL",
  "count": 3,
  "annotations": [
    {
      "id": "anno_1640000000000_abc123",
      "symbol": "AAPL",
      "timeframe": "5m",
      "created_at": 1640000000000,
      "expires_at": 1640003600000,
      "signal_id": "550e8400-e29b-41d4-a716-446655440000",
      "confidence_score": 0.85,
      "lines": [
        {
          "type": "entry",
          "price": 150.25,
          "color": "#00FF00",
          "label": "Entry ↑",
          "style": "solid",
          "width": 2
        },
        {
          "type": "stop_loss",
          "price": 149.50,
          "color": "#FF0000",
          "label": "SL",
          "style": "dashed",
          "width": 1
        },
        {
          "type": "take_profit",
          "price": 152.00,
          "color": "#00FF00",
          "label": "TP",
          "style": "dashed",
          "width": 1
        }
      ],
      "labels": [
        {
          "type": "confidence",
          "text": "Confidence: 85%",
          "color": "#00FF00",
          "fontSize": 10
        }
      ]
    }
  ]
}
```

### POST /api/tv-sync/:symbol/annotations/ack

**Chrome extension confirms annotation delivery**

Request Body:
```json
{
  "annotation_ids": ["anno_1640000000000_abc123", "anno_1640000000000_def456"]
}
```

Response:
```json
{
  "ok": true,
  "symbol": "AAPL",
  "acknowledged": 2,
  "failed": 0,
  "failed_ids": []
}
```

### POST /api/tv-sync/:symbol/annotations/signal

**Push a signal annotation (convenience endpoint)**

Request Body:
```json
{
  "timeframe": "5m",
  "entry_price": 150.25,
  "stop_loss": 149.50,
  "take_profit": 152.00,
  "direction": "long",
  "confidence": 0.85,
  "setup_type": "order_block_entry",
  "reasoning": "Bullish order block hit at previous high"
}
```

Response:
```json
{
  "ok": true,
  "symbol": "AAPL",
  "annotation_id": "anno_1640000000000_xyz789",
  "message": "Signal annotation created"
}
```

### POST /api/tv-sync/:symbol/annotations/structures

**Push structure markings (BOS, CHOCH, OB, FVG, etc)**

Request Body:
```json
{
  "timeframe": "5m",
  "structures": [
    {
      "type": "bos",
      "price_high": 151.00,
      "price_low": 150.00,
      "color": "#0099FF",
      "label": "Bullish BOS"
    },
    {
      "type": "fvg",
      "price_high": 149.80,
      "price_low": 149.70,
      "color": "#00FF00",
      "label": "Bullish FVG"
    }
  ]
}
```

Response:
```json
{
  "ok": true,
  "symbol": "AAPL",
  "annotation_id": "anno_1640000000000_struct123",
  "message": "Structure annotation created"
}
```

### GET /api/tv-sync/stats

**Annotation statistics across all symbols**

Response:
```json
{
  "ok": true,
  "stats": {
    "total_symbols": 5,
    "total_pending": 12,
    "total_acknowledged": 47,
    "by_symbol": {
      "AAPL": { "pending": 3, "acknowledged": 12 },
      "SPY": { "pending": 2, "acknowledged": 8 },
      "BTCUSD": { "pending": 7, "acknowledged": 27 }
    }
  }
}
```

---

## MCP Server Tools

The TradingView MCP server exposes these tools for use in Claude:

### get_webhook_stats
Returns webhook statistics (total received, deduplicated, errors, last signal time).

### get_webhook_history
Retrieve recent signals from TradingView webhooks. Supports filtering by symbol and limit.

### get_annotations
Get pending chart annotations for a symbol (entry/exit lines, SL/TP, labels).

### push_annotation
Push a chart annotation to TradingView. Supports signal and structure types.

### get_annotation_stats
Get annotation statistics across all symbols.

---

## Testing

### Test Webhook with cURL

```bash
curl -X POST https://your-godsview-domain.com/api/tv-webhook \
  -H "Authorization: Bearer your_super_secure_webhook_secret_here" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "signal": "order_block_entry",
    "timeframe": "5m",
    "price": 150.25,
    "timestamp": 1640000000000,
    "direction": "long",
    "stop_loss": 149.50,
    "take_profit": 152.00,
    "strategy_name": "GodsView SMC v1"
  }'
```

### Expected Response (Success)

```json
{
  "ok": true,
  "received": true,
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "deduplicated": false
}
```

### Test Duplicate Detection

Send the same payload twice within 60 seconds. The second should have `"deduplicated": true`.

### Check Stats

```bash
curl https://your-godsview-domain.com/api/tv-webhook/stats \
  -H "Authorization: Bearer your_super_secure_webhook_secret_here"
```

### Get Signal History

```bash
curl https://your-godsview-domain.com/api/tv-webhook/history?limit=50&symbol=AAPL
```

---

## Deduplication Logic

The webhook uses a **hash-based deduplication** window:

1. **Hash Key**: `symbol|action|timeframe|minute_timestamp`
2. **TTL**: 60 seconds
3. **Hash Algorithm**: SHA-256

Example:
- Signal 1: AAPL, order_block_entry, 5m, 12:45:30 → stored
- Signal 2 (12:45:59): AAPL, order_block_entry, 5m → **DUPLICATE** (same minute)
- Signal 3 (12:46:05): AAPL, order_block_entry, 5m → **NEW** (different minute)

---

## Monitoring & Observability

### Key Metrics

- **total_received**: cumulative webhook calls
- **total_deduplicated**: duplicate prevention count
- **total_errors**: validation/conversion failures
- **last_signal_time**: timestamp of most recent accepted signal
- **buffer_size**: current signals in circular buffer

### Logging

All webhook events are logged with:
- Signal ID
- Symbol
- Action type
- Deduplication status
- Validation errors (if any)

Check logs:
```bash
# Docker
docker logs godsview-api-server | grep "tv-webhook"

# Local
tail -f /var/log/godsview/api-server.log | grep "tv-webhook"
```

---

## Chrome Extension Integration

The GodsView Chrome extension:
1. Polls `/api/tv-sync/:symbol/annotations` every 5 seconds
2. Renders annotations on the TradingView chart
3. Confirms delivery via POST to `/api/tv-sync/:symbol/annotations/ack`
4. Re-polls after acknowledgment

### Extension Installation

1. Download the extension from the GodsView dashboard
2. Install via Chrome's `chrome://extensions/`
3. Grant permissions for TradingView.com
4. Configure your API URL in extension settings

---

## Troubleshooting

### "Unauthorized" (401)

Check that:
1. `TV_WEBHOOK_SECRET` is set in your `.env`
2. The `Authorization: Bearer` header matches your secret
3. Bearer token has no extra whitespace

### "Validation failed"

Verify the JSON payload includes:
- `symbol` (required)
- `signal` or `setup_type` (required)
- `timeframe` (required)
- `entry_price` > 0 (required)
- `stop_loss` > 0 (required)
- `take_profit` > 0 (required)

### Signals not appearing in history

1. Check `/api/tv-webhook/stats` — is `total_received` > 0?
2. If `total_errors` is high, check the `last_error` field
3. Verify deduplication — try sending from a different timeframe

### Chrome extension not showing annotations

1. Verify extension is installed and enabled
2. Check `/api/tv-sync/SYMBOL/annotations` manually
3. Verify API URL is correct in extension settings
4. Check extension logs in `chrome://extensions/` (Developer Mode)

---

## Production Checklist

- [ ] Set `TV_WEBHOOK_SECRET` to a strong random string
- [ ] Configure HTTPS for webhook endpoint
- [ ] Enable CORS for TradingView domain (if needed)
- [ ] Set up monitoring alerts for webhook errors
- [ ] Test webhook with real strategy alerts
- [ ] Install and test Chrome extension
- [ ] Verify signal deduplication works
- [ ] Check circular buffer doesn't overflow
- [ ] Monitor API response times (target <100ms)
- [ ] Set up log rotation for webhook events
- [ ] Document your alert configuration in team wiki

---

## Related Files

- **Webhook Route**: `/artifacts/api-server/src/routes/tv_webhook.ts`
- **Sync Route**: `/artifacts/api-server/src/routes/tv_sync.ts`
- **Sync Library**: `/artifacts/api-server/src/lib/tradingview/tv_overlay_sync.ts`
- **Pine Script**: `/docs/pine_scripts/smc_strategy.pine`
- **MCP Server**: `/mcp-servers/tradingview/src/index.ts`

---

## Version History

- **v1.0** (2026-04): Initial webhook integration with deduplication and bidirectional sync
