# Observability Layer Usage Guide

## Overview

The observability layer provides unified structured logging, health checks, readiness probes, incident timeline tracking, and SLO burn rate calculation for the GodsView trading platform.

## Quick Start

### 1. Structured Logging

```typescript
import { structuredLogger, setLogContext, getLogContext } from './observability';

// Set context for request lifecycle
setLogContext({
  correlationId: 'req-123',
  userId: 'user-456',
  sessionId: 'session-789',
});

// Log messages
structuredLogger.info('Processing signal', { symbol: 'BTCUSD', strength: 0.85 });
structuredLogger.warn('High latency detected', { ms: 250 });
structuredLogger.error('Trade failed', { reason: 'insufficient_funds' });

// Get current context
const ctx = getLogContext();
console.log(ctx.correlationId); // Used for request tracing
```

Output includes: timestamp, level, service, correlationId, message, data

### 2. Health Checks

```typescript
import { registerHealthCheck, runHealthChecks } from './observability';

// Register custom health check
registerHealthCheck('pricing-service', async () => {
  try {
    await fetchLatestPrices();
    return { status: 'ok', latencyMs: 42 };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
});

// Run all checks
const health = await runHealthChecks();
console.log(health.status); // 'healthy' or 'degraded'
console.log(health.checks); // { database, redis, broker, pricing-service, ... }
```

### 3. Readiness Probe

```typescript
import { readinessProbe } from './observability';

// Get readiness status
const probe = await readinessProbe();

if (probe.ready) {
  console.log(`Ready! Version: ${probe.version}, Uptime: ${probe.uptime}s`);
}

// In express route
app.get('/api/v1/ready', async (req, res) => {
  const probe = await readinessProbe();
  res.status(probe.ready ? 200 : 503).json(probe);
});
```

### 4. Incident Timeline Recorder

```typescript
import {
  recordIncidentEvent,
  resolveIncident,
  getIncidentTimeline,
} from './observability';

// Record incident event
const incidentId = recordIncidentEvent({
  correlationId: 'req-123',
  eventType: 'trade_failed',
  severity: 'critical',
  component: 'execution-engine',
  message: 'Failed to execute market order',
  data: { orderId: 'ord-456', reason: 'insufficient_balance' },
});

// Later, when issue is resolved
resolveIncident(incidentId);

// Query incident history
const timeline = getIncidentTimeline(incidentId);
console.log(timeline.events); // All events for this incident
console.log(timeline.severity); // Escalated to critical if any event was critical
```

### 5. SLO Tracking

```typescript
import {
  recordSLOEvent,
  calculateSLOBurnRate,
  getSLOStatus,
} from './observability';

// Record events as they occur
const success = await executeSignal(signal);
recordSLOEvent('signal-processing', success);

// Check SLO status
const burnRate = calculateSLOBurnRate('signal-processing');
if (burnRate.isErroring) {
  logger.warn('SLO burn rate exceeded', {
    currentRate: burnRate.currentBurnRate,
    threshold: burnRate.threshold,
  });
}

// Get all SLO statuses
const slos = getSLOStatus();
slos.forEach(slo => {
  console.log(`${slo.target}: ${slo.currentBurnRate.toFixed(2)}% burn rate`);
});
```

## API Endpoints

### GET /api/v1/health
Comprehensive health check with observability data.

```bash
curl http://localhost:3000/api/v1/health

{
  "status": "healthy",
  "ready": true,
  "version": "1.0.0",
  "uptime": 1234.56,
  "dependencies": {
    "database": { "status": "ok", "latencyMs": 5 },
    "redis": { "status": "ok", "latencyMs": 2 },
    "broker": { "status": "ok" },
    "api-server": { "status": "ok" }
  },
  "memory": { "rss_mb": 256 },
  "eventLoopLag": { "ms": 3, "healthy": true },
  "correlationId": "health-check-123"
}
```

### GET /api/v1/ready
Kubernetes-style readiness probe.

```bash
curl http://localhost:3000/api/v1/ready

{
  "ready": true,
  "version": "1.0.0",
  "uptime": 1234.56,
  "dependencies": [
    {
      "name": "database",
      "status": "ok",
      "latency_ms": 5
    }
  ]
}
```

### GET /api/v1/observability/incidents?limit=20
Query incident timeline.

```bash
curl "http://localhost:3000/api/v1/observability/incidents?limit=10"

{
  "incidents": [
    {
      "incidentId": "incident-1234-abcd",
      "severity": "critical",
      "startTime": "2026-04-20T10:30:00Z",
      "resolved": false,
      "eventCount": 3,
      "events": [
        {
          "timestamp": "2026-04-20T10:30:00Z",
          "type": "trade_failed",
          "severity": "critical",
          "component": "execution",
          "message": "Order rejected by broker"
        }
      ]
    }
  ],
  "count": 1
}
```

### GET /api/v1/observability/slo-status
Get SLO burn rates.

```bash
curl http://localhost:3000/api/v1/observability/slo-status

{
  "slos": [
    {
      "target": "api-availability",
      "window": "24h",
      "currentBurnRate": "0.05%",
      "budgetRemaining": "99.85%",
      "isErroring": false,
      "threshold": "1.00%"
    }
  ],
  "count": 3,
  "timestamp": "2026-04-20T10:35:00Z"
}
```

## Event Types

### Incident Event Types
- `signal_generated` — Signal passed validation
- `signal_rejected` — Signal blocked by gate
- `trade_executed` — Order placed successfully
- `trade_failed` — Order execution failed
- `health_degraded` — Service health declined
- `error_occurred` — Unhandled error
- `recovery` — Service recovered
- `gate_triggered` — Risk gate activated

### Severity Levels
- `info` — Informational event
- `warning` — Warning that may need attention
- `critical` — Critical issue requiring immediate response

## Integration with Express

The observability layer includes middleware that automatically:
- Attaches `x-correlation-id` header to responses
- Extracts correlation ID from incoming requests
- Sets request context (path, method)
- Propagates context through async operations

```typescript
import observabilityRouter from './routes/observability';

app.use(observabilityRouter); // Adds middleware + endpoints
```

## Best Practices

1. **Always include correlationId in logs**: Use `setLogContext()` at request entry point
2. **Record SLO events for key operations**: Track success/failure of critical paths
3. **Register health checks early**: Call `registerHealthCheck()` during startup
4. **Resolve incidents when issue is fixed**: Call `resolveIncident()` to close timeline
5. **Use appropriate severity levels**: `critical` for immediate response needed
6. **Include context data**: Pass `data` object with diagnostic information
7. **Don't block on observability**: Use non-blocking incident recording

## Monitoring

### Prometheus Metrics (via /metrics endpoint)
- `godsview_http_requests_total` — Total HTTP requests
- `godsview_http_request_duration_seconds` — Request latency
- `godsview_signals_processed_total` — Signals processed
- `godsview_trades_executed_total` — Trades executed

### Alert Conditions
- Health check status != healthy
- Event loop lag > 100ms
- SLO burn rate > threshold
- Memory usage > 512MB
- Any incident with severity = critical

## Production Considerations

- Incident timeline is in-memory; implement persistent storage for forensics
- Correlation IDs enable distributed tracing; integrate with APM tools
- SLO tracking drives alert routing; customize thresholds per environment
- Health checks prevent cascading failures; keep checks lightweight
- Structured logging enables log aggregation; use with ELK/Datadog/etc

## Examples

### Tracing a Signal Through the Pipeline

```typescript
const correlationId = `signal-${Date.now()}`;
setLogContext({ correlationId });

structuredLogger.info('Signal validation started', { symbol });
const valid = await validateSignal(signal);

if (!valid) {
  recordIncidentEvent({
    correlationId,
    eventType: 'signal_rejected',
    severity: 'warning',
    component: 'validator',
    message: 'Signal quality too low',
    data: { quality, threshold },
  });
  recordSLOEvent('signal-processing', false);
  return;
}

structuredLogger.info('Signal validated', { symbol });
recordSLOEvent('signal-processing', true);

// Later: resolve incident when conditions improve
resolveIncident(incidentId);
```

### Custom Health Check for External Service

```typescript
registerHealthCheck('alpaca-api', async () => {
  const start = Date.now();
  try {
    const account = await alpaca.getAccount();
    const latencyMs = Date.now() - start;
    return {
      status: 'ok',
      latencyMs,
      details: { equity: account.equity },
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
    };
  }
});
```
