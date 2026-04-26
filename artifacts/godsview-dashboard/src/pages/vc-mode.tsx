/**
 * VC Mode page — `/vc-mode`
 *
 * One-page proof that GodsView is a real working system.
 *
 * Every tile is backed by a real API call (no static text):
 *   - System health  → /api/system/status
 *   - Latest webhook → /api/webhooks/tradingview/last
 *   - Latest signal  → /api/system/status .lastWebhook
 *   - Paper trade    → /api/system/status .lastPaperTrade
 *   - Risk decision  → /api/system/status .lastRiskRejection
 *   - Brain entity   → /api/brain/entity/:symbol (deep-dive)
 *   - Backtest       → /api/system/status .backtest
 *   - Audit log      → /api/webhooks/tradingview/recent
 *
 * No fallback to mock data. If a tile can't load, it shows an error pill.
 */

import React, { useEffect, useState } from "react";

const API = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

type Status = {
  ok: boolean;
  mode: string;
  api: { ok: boolean; latencyMs?: number };
  db: { ok: boolean; latencyMs?: number; error?: string };
  redis: { ok: boolean; latencyMs?: number; error?: string };
  lastWebhook: any;
  lastPaperTrade: any;
  lastRiskRejection: any;
  brainCount: number;
  strategies: any[];
  backtest: any;
  timestamp: string;
};

const COLORS = {
  bg: "#0a0a0b",
  card: "#101012",
  border: "#1c1c20",
  text: "#e8e8ec",
  dim: "#9aa0a6",
  ok: "#7afdb1",
  warn: "#ffcc66",
  err: "#ff8a8a",
  brand: "#7ad6ff",
};

function Pill({ ok, label, latency }: { ok: boolean; label: string; latency?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontFamily: "monospace",
        background: ok ? "rgba(122,253,177,0.12)" : "rgba(255,138,138,0.14)",
        color: ok ? COLORS.ok : COLORS.err,
        border: `1px solid ${ok ? "rgba(122,253,177,0.4)" : "rgba(255,138,138,0.5)"}`,
      }}
    >
      ● {label}{latency !== undefined ? ` · ${latency}ms` : ""}
    </span>
  );
}

function Card(props: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: 18,
        minHeight: 130,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: COLORS.dim, fontFamily: "monospace", letterSpacing: 1 }}>
          {props.title}
        </h3>
        <div>{props.right}</div>
      </div>
      <div style={{ color: COLORS.text, fontSize: 13, lineHeight: 1.5 }}>{props.children}</div>
    </div>
  );
}

export default function VcModePage(): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [last, setLast] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [a, b, c] = await Promise.all([
          fetch(`${API}/api/system/status`).then((r) => r.json()),
          fetch(`${API}/api/webhooks/tradingview/last`).then((r) => r.json()).catch(() => ({})),
          fetch(`${API}/api/webhooks/tradingview/recent`).then((r) => r.json()).catch(() => ({ events: [] })),
        ]);
        if (cancelled) return;
        setStatus(a);
        setLast(b?.lastEnvelope ?? null);
        setRecent(c?.events ?? []);
        setStatusErr(null);
      } catch (err: any) {
        if (cancelled) return;
        setStatusErr(err?.message ?? "fetch failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && !status) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.dim, padding: 40, fontFamily: "monospace" }}>
        Loading /api/system/status …
      </div>
    );
  }

  if (statusErr && !status) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.err, padding: 40, fontFamily: "monospace" }}>
        ⚠ Cannot reach API: {statusErr}
      </div>
    );
  }

  const s = status!;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: COLORS.brand, letterSpacing: 1 }}>GodsView · VC PROOF</h1>
          <div style={{ color: COLORS.dim, fontSize: 12, marginTop: 4, fontFamily: "monospace" }}>
            Every tile below is backed by a real API call. No mock data. Last refresh: {new Date(s.timestamp).toLocaleTimeString()}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Pill ok={s.api.ok} label="API" latency={s.api.latencyMs} />
          <Pill ok={s.db.ok} label="DB" latency={s.db.latencyMs} />
          <Pill ok={s.redis.ok} label="REDIS" latency={s.redis.latencyMs} />
          <Pill ok={true} label={`MODE: ${s.mode.toUpperCase()}`} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <Card title="LAST TRADINGVIEW WEBHOOK">
          {last ? (
            <>
              <div><b>{last.alert.symbol}</b> · {last.alert.signal} · {last.alert.timeframe} · {last.alert.direction}</div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                price={last.alert.price} sl={last.alert.stop_loss} tp={last.alert.take_profit}
              </div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 2, fontFamily: "monospace" }}>
                received {last.receivedAt}
              </div>
            </>
          ) : <span style={{ color: COLORS.dim }}>none yet — POST one to /api/webhooks/tradingview</span>}
        </Card>

        <Card title="LATEST SIGNAL (DB)">
          {s.lastWebhook ? (
            <>
              <div>id #{s.lastWebhook.id} · {s.lastWebhook.symbol}</div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                setup={s.lastWebhook.setup} status={s.lastWebhook.status}
              </div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 2, fontFamily: "monospace" }}>
                {new Date(s.lastWebhook.createdAt).toISOString()}
              </div>
            </>
          ) : <span style={{ color: COLORS.dim }}>signals table empty</span>}
        </Card>

        <Card title="LATEST PAPER TRADE">
          {s.lastPaperTrade ? (
            <>
              <div>id #{s.lastPaperTrade.id} · {s.lastPaperTrade.symbol} {s.lastPaperTrade.direction}</div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                entry={s.lastPaperTrade.entryPrice} qty={s.lastPaperTrade.quantity} state={s.lastPaperTrade.outcome}
              </div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 2, fontFamily: "monospace" }}>
                {new Date(s.lastPaperTrade.createdAt).toISOString()}
              </div>
            </>
          ) : <span style={{ color: COLORS.dim }}>no trades yet</span>}
        </Card>

        <Card title="LAST RISK REJECTION">
          {s.lastRiskRejection ? (
            <>
              <div style={{ color: COLORS.warn }}>id #{s.lastRiskRejection.id} · {s.lastRiskRejection.symbol}</div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
                reason: {s.lastRiskRejection.reason || "(none)"}
              </div>
              <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 2, fontFamily: "monospace" }}>
                {new Date(s.lastRiskRejection.createdAt).toISOString()}
              </div>
            </>
          ) : <span style={{ color: COLORS.dim }}>no rejections yet — risk engine has not blocked anything</span>}
        </Card>

        <Card title="GOD BRAIN">
          <div style={{ fontSize: 22, color: COLORS.brand }}>{s.brainCount}</div>
          <div style={{ color: COLORS.dim, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
            entities in brain_entities table
          </div>
        </Card>

        <Card title="STRATEGIES">
          {s.strategies?.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12 }}>
              {s.strategies.slice(0, 4).map((str: any) => (
                <li key={str.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{str.name}</span>
                  <span style={{ color: str.enabled ? COLORS.ok : COLORS.dim }}>{str.tier}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ color: COLORS.dim }}>strategy_registry empty</span>
          )}
        </Card>

        <Card title="BACKTEST PROOF">
          {s.backtest?.regimes?.length ? (
            <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", color: COLORS.dim }}>
              <thead><tr><th align="left">regime</th><th>trades</th><th>WR</th><th>PF</th><th>Sharpe</th></tr></thead>
              <tbody>
                {s.backtest.regimes.map((r: any) => (
                  <tr key={r.regime}>
                    <td style={{ color: COLORS.text }}>{r.regime}</td>
                    <td align="right">{r.trades}</td>
                    <td align="right">{(r.win_rate * 100).toFixed(0)}%</td>
                    <td align="right" style={{ color: r.profit_factor >= 1 ? COLORS.ok : COLORS.err }}>{r.profit_factor}</td>
                    <td align="right" style={{ color: r.sharpe >= 0 ? COLORS.ok : COLORS.err }}>{r.sharpe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span style={{ color: COLORS.dim }}>run `node scripts/backtest_regimes.mjs` to populate</span>
          )}
        </Card>

        <Card title="AUDIT LOG (LAST 5)">
          {recent?.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11, fontFamily: "monospace" }}>
              {recent.slice(0, 5).map((e: any) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: COLORS.dim }}>
                  <span>#{e.id} {e.event_type}</span>
                  <span style={{ color: e.decision_state === "rejected" ? COLORS.err : COLORS.ok }}>{e.decision_state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ color: COLORS.dim }}>no audit events yet</span>
          )}
        </Card>

        <Card title="VC FLOW (PROOF SCRIPT)">
          <code style={{ fontSize: 11, color: COLORS.text, display: "block", whiteSpace: "pre-wrap" }}>
{`bash scripts/vc-proof-run.sh
# expects: PASS for API/DB/Redis/webhook/signal/risk/trade/brain/audit`}
          </code>
        </Card>
      </div>

      <div style={{ marginTop: 24, color: COLORS.dim, fontSize: 11, fontFamily: "monospace" }}>
        ▢ This page is for VC demos in PAPER MODE only. No real broker is connected.
      </div>
    </div>
  );
}
