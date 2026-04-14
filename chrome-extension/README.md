# GodsView TradingView Bridge — Chrome Extension

Capture chart context from TradingView and POST signals to the GodsView
MCP webhook. Renders the GodsView decision (action, grade, confidence,
thesis, rejection reasons) back onto the chart and into the popup.

## Install (sideload)

1. Open `chrome://extensions` in Chrome / Brave / Edge.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Pick the `chrome-extension/` folder from this repo.
5. The extension icon appears in the toolbar.
6. Click the icon → set **Server URL** (e.g. `http://127.0.0.1:5001`) →
   click **Save** → click **Test connection**. Status should turn green
   (`up`) with a latency reading.

## How it works

- `manifest.json` — MV3 manifest with TradingView host permissions and
  alarm/storage access.
- `background.js` — service worker. Owns the connection to the GodsView
  server. Pings `/api/health` every minute, POSTs captured signals to
  `/api/tv-webhook`, persists the last signal + decision in
  `chrome.storage.local`.
- `content.js` — runs on `tradingview.com/chart/*` and `/symbols/*`.
  Auto-detects `symbol`, `timeframe`, `price` from the DOM and renders
  a floating capture panel ("GODSVIEW CAPTURE") in the bottom-right.
  User picks direction + signal type and clicks **Capture**. Decision
  is rendered inline (action / grade / confidence / thesis).
- `popup.html` + `popup.js` — toolbar popup. Shows server status,
  last ping, last signal, last decision. Lets the user change the
  server URL and webhook passphrase.

## Webhook contract

POSTs JSON to `<serverUrl>/api/tv-webhook` matching the schema in
`artifacts/api-server/src/lib/tradingview_mcp/types.ts`
(`TradingViewWebhookSchema`):

```json
{
  "symbol": "AAPL",
  "signal": "order_block_entry",
  "direction": "long",
  "timeframe": "1h",
  "price": 175.5,
  "timestamp": 1776170422,
  "stop_loss": 173,
  "take_profit": 180,
  "strategy_name": "chrome_extension_capture",
  "passphrase": ""
}
```

The server returns:

```json
{
  "ok": true,
  "signalId": "sig_tradingview_…",
  "action": "execute|watch|reject",
  "direction": "long|short|none",
  "confidence": 0.78,
  "grade": "A|B|C|D|F",
  "overallScore": 82,
  "thesis": "…",
  "rejectionReasons": ["…"]
}
```

## Packaging as `.crx`

The unpacked folder is what Chrome loads — for distribution:

```bash
# from the repo root
zip -r dist/godsview-bridge.zip chrome-extension -x "*/dist/*"
```

Or use `chrome://extensions` → **Pack extension** to produce a signed
`.crx` + `.pem`. The first `.pem` should be kept private and reused for
all subsequent versions to preserve the extension ID.

## Limitations

- TradingView's DOM changes; if the panel shows `—` for symbol/price,
  refresh the page or update the selectors in `content.js`
  (`detectSymbol`, `detectTimeframe`, `detectPrice`).
- Bidirectional sync (drawing GodsView annotations back onto the
  TradingView chart) is **not** done via the public chart canvas — it's
  surfaced via the in-page panel and via the dashboard's
  `/api/overlay/*` routes. True canvas overlays require the TradingView
  Charting Library (paid licence) or the public widget API.
- The included icons are 1×1 placeholder PNGs; replace them with branded
  artwork before distribution.

## Verifying end-to-end

With the api-server running locally:

```bash
GODSVIEW_DATA_DIR=./.runtime GODSVIEW_SYSTEM_MODE=paper PORT=5001 \
  pnpm --filter @workspace/api-server run start
```

then open any TradingView chart, click **Capture**, and check
`/api/tradingview/stats` — `totalReceived` should increment and
`recentDecisions` should include the captured signal.
