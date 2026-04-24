# Data Safety Guard - Quick Start Guide

## What Was Done

Fixed synthetic data contamination in GodsView by creating a **mode-aware safety guard** that:
- **Allows** synthetic data in paper/demo mode (for testing)
- **Blocks** synthetic data in live/strict_live mode (for production)

## Three Key Files to Know

### 1. Data Safety Guard (NEW)
**File:** `api-server/src/lib/data_safety_guard.ts` (86 lines)

Core functions:
```typescript
// Check if live mode
if (isLiveMode()) { /* special handling */ }

// Allow/block synthetic (returns boolean)
if (allowSyntheticFallback("context")) {
  data = generate();
  logSyntheticUsage("context");
}

// Wrap synthetic generation (throws in live mode)
data = guardSyntheticData("context", () => generate(), "Error msg");
logSyntheticUsage("context");
```

### 2. Protected Files (UPDATED)
Five files now block synthetic fallbacks in live mode:

| File | Protected | Method |
|------|-----------|--------|
| backtester.ts | Synthetic bars | guardSyntheticData() |
| tiingo_client.ts | API fallback | guardSyntheticData() |
| market_structure.ts | Chart data | guardSyntheticData() |
| tradingview_overlay.ts | Overlay bars | guardSyntheticData() |
| accuracy_seeder.ts | ML training | allowSyntheticFallback() |

### 3. Environment Control
Set one variable to control behavior:

```bash
export GODSVIEW_SYSTEM_MODE=paper      # Default: synthetic ALLOWED
export GODSVIEW_SYSTEM_MODE=live       # Production: synthetic BLOCKED
```

## Common Scenarios

### Scenario 1: Paper Trading (Testing)
```bash
export GODSVIEW_SYSTEM_MODE=paper
npm run backtest AAPL
# Works fine even without Alpaca key
# Logs: "Synthetic data fallback activated" (WARN)
```

### Scenario 2: Live Trading (Production)
```bash
export GODSVIEW_SYSTEM_MODE=live
npm run backtest AAPL
# Without Alpaca key → throws error
# Logs: "BLOCKED: Synthetic data fallback attempted" (ERROR)
```

### Scenario 3: Verify Guard Works
```bash
# Check if guard is active
grep "data_safety_guard" artifacts/api-server/src/lib/backtester.ts
# Output: import { guardSyntheticData, logSyntheticUsage } from "./data_safety_guard";

# Check for guard wrapping
grep -A3 "guardSyntheticData" artifacts/api-server/src/lib/backtester.ts | head -5
```

## Testing Checklist

```bash
# 1. Paper mode - synthetic should work
GODSVIEW_SYSTEM_MODE=paper npm test
# Check logs for: "Synthetic data fallback activated"

# 2. Live mode - synthetic should fail
GODSVIEW_SYSTEM_MODE=live npm test
# Check logs for: "BLOCKED: Synthetic data fallback attempted"

# 3. Live mode with real API key - should work
GODSVIEW_SYSTEM_MODE=live ALPACA_API_KEY=xxx npm test
# No synthetic logs should appear
```

## Key Files Documentation

- **SYNTHETIC_DATA_SAFETY_FIXES.md** - Full architecture & design
- **IMPLEMENTATION_COMPLETION_REPORT.md** - Detailed completion status
- **CHANGES_SUMMARY.txt** - All modified files listed

## Error Messages (You'll See These in Live Mode)

```
Cannot backtest AAPL: real market data unavailable and synthetic data blocked in live mode
All market data APIs failed for BTC/5min. Synthetic data blocked in live mode.
Market structure analysis requires real data for SPY. Synthetic data blocked in live mode.
TradingView overlay requires real data for QQQ. Synthetic data blocked in live mode.
Synthetic bootstrap skipped — live mode requires real training data
```

These errors are **good** - they mean the guard is working and preventing fake data.

## Monitoring

Check synthetic usage (in paper mode):
```typescript
import { getSyntheticUsageStats } from "./data_safety_guard";
const stats = getSyntheticUsageStats();
console.log(`Total synthetic fallbacks: ${stats.totalSyntheticFallbacks}`);
console.log(`Recent fallbacks:`, stats.recentFallbacks);
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Backtest fails in live mode | Provide Alpaca API key or set GODSVIEW_SYSTEM_MODE=paper |
| Synthetic logs appearing in live | Check GODSVIEW_SYSTEM_MODE is set to live, not paper |
| Guard not working | Verify import exists in file: `import { guardSyntheticData }` |

## For Developers

Adding guard to new synthetic generation:

```typescript
// Import
import { guardSyntheticData, logSyntheticUsage } from "./data_safety_guard";

// Usage
const data = guardSyntheticData(
  "unique:context:tag",           // Context for logging
  () => generateSynthetic(),       // Synthetic function
  "Clear error message"            // What went wrong
);
logSyntheticUsage("unique:context:tag");
```

The guard will:
- In paper/demo: execute and log WARN
- In live/strict_live: throw error with your message

## Summary

✓ Synthetic data BLOCKED in live mode  
✓ Synthetic data ALLOWED in paper mode  
✓ All 5 sources protected (backtester, data clients, market analysis, ML training)  
✓ Clear error messages when synthetic data is needed  
✓ Full audit trail via logging and statistics  
✓ Zero breaking changes to existing code  

Ready for production deployment.
