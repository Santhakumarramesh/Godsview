# TradingView Webhook Integration - Architecture

## System Diagram

```
                            ┌──────────────────────────┐
                            │   TradingView Chart      │
                            │  (Pine Script Running)   │
                            └────────────┬─────────────┘
                                         │
                                    [Alert Fires]
                                         │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
            POST /api/tv-webhook                   Chrome Extension
            (Bearer Token)                         (Polling)
                    │                                         │
                    ▼                                         │
        ┌─────────────────────────┐                          │
        │  Authentication Check   │                          │
        │ (TV_WEBHOOK_SECRET)     │                          │
        └────────┬────────────────┘                          │
                 │                                            │
            ✓ Valid                                           │
                 │                                            │
        ┌────────▼────────────────┐                          │
        │ Parse JSON Payload      │                          │
        │ Validate Required Fields│                          │
        │ - symbol               │                          │
        │ - signal/action        │                          │
        │ - entry, stop, target  │                          │
        └────────┬────────────────┘                          │
                 │                                            │
                 ▼                                            │
        ┌─────────────────────────┐                          │
        │ Deduplication Check     │                          │
        │ SHA256 Hash:            │                          │
        │ symbol|action|tf|minute │                          │
        │ TTL: 60 seconds         │                          │
        └────────┬────────────────┘                          │
                 │                                            │
         ┌───────┴───────┐                                   │
         │               │                                   │
      DUPLICATE      NEW SIGNAL                             │
         │               │                                   │
         │        ┌──────▼──────────┐                       │
         │        │ Convert to      │                       │
         │        │ Internal Signal │                       │
         │        └──────┬──────────┘                       │
         │               │                                   │
         │        ┌──────▼──────────┐                       │
         │        │  Store in       │                       │
         │        │ CircularBuffer  │                       │
         │        │ (max 500)       │                       │
         │        └──────┬──────────┘                       │
         │               │                                   │
         │        ┌──────▼──────────────┐                  │
         │        │ Broadcast via      │                  │
         │        │ WebSocket Clients  │                  │
         │        │ (Dashboard)        │                  │
         │        └──────┬─────────────┘                  │
         │               │                                 │
         │        ┌──────▼──────────────┐                 │
         │        │ Push to Signal      │                 │
         │        │ Queue               │                 │
         │        │ POST /api/v2/signals│                 │
         │        └──────┬─────────────┘                  │
         │               │                                 │
         └───┬───────────┼─────────────────┬──────────────┘
             │           │                 │
        deduplicated: true    Return signal_id      │
                            deduplicated: false     │
                                                    │
                                    ┌───────────────▼────────────┐
                                    │ Claude or Internal System  │
                                    │ Builds Annotation          │
                                    └───────────┬────────────────┘
                                                │
                        ┌───────────────────────┘
                        │
                        ▼
            POST /api/tv-sync/:symbol/annotations/signal
                        │
                        ▼
        ┌──────────────────────────────┐
        │ Build Annotation Structure   │
        │ - Entry/SL/TP Lines         │
        │ - Confidence Label           │
        │ - Reasoning Text            │
        └──────────┬───────────────────┘
                   │
                   ▼
        ┌──────────────────────────────┐
        │ Store in Annotation Buffer   │
        │ (by symbol, TTL: 1 hour)     │
        └──────────┬───────────────────┘
                   │
                   ◄─────────────────────────┐
                   │                          │
                   │  Chrome Extension        │
                   │  Polls every 5 seconds   │
                   │                          │
    GET /api/tv-sync/:symbol/annotations
```

---

## Component Architecture

### Webhook Receiver

```
POST /api/tv-webhook
  ├─ validateWebhookAuth()
  ├─ convertToInternalSignal()
  ├─ validateSignal()
  ├─ dedup.isDuplicate()
  ├─ dedup.markSeen()
  ├─ signalBuffer.add()
  ├─ broadcastSignal()
  ├─ pushToSignalQueue()
  └─ res.json()
```

### Deduplication Manager

```
hash = SHA256(symbol|action|timeframe|minute)
TTL = 60 seconds
Auto-cleanup on access
```

### Signal Buffer

```
Circular array (max 500 signals)
O(1) access, memory-bounded
Most recent first
```

---

## Memory Usage Summary

```
Deduplication: ~80 KB
Signal Buffer: ~2 MB
Annotation Buffer: ~1 MB
─────────────────────
Total: ~3-4 MB
```

---

## Performance

```
Webhook response: 5-10 ms (without broadcast)
                  20-80 ms (with signal queue)
P95: 120 ms
P99: 250 ms

Annotation endpoints: 2-8 ms
```

---

## Scalability Notes

- Single pod: ~1000 alerts/second
- In-memory state (pods are independent)
- Phase 2: Add Redis + PostgreSQL for distributed deployment
