import { useEffect, useRef } from "react";
import { wsManager, useWSConnection } from "@/lib/ws";
import { marketStore } from "@/lib/market-store";
import { useAlpacaTicker, useRiskConfig, useSystemStatus } from "@/lib/api";
import { DEFAULT_WATCH_SYMBOLS } from "@/lib/market/symbols";

/**
 * GlobalDataProvider
 * Sits near the top of the component tree (inside QueryClientProvider).
 * Ensures WebSocket connection is active and feeds market store with
 * API polling data as a fallback when WS isn't delivering updates.
 */
export function GlobalDataProvider({ children }: { children: React.ReactNode }) {
  const wsConnected = useWSConnection();

  // Subscribe to key WS channels on mount
  useEffect(() => {
    const channels = [
      ...DEFAULT_WATCH_SYMBOLS.slice(0, 10).map((s) => `ticker:${s}`),
      "signals",
      "decisions",
      "risk",
      "brain",
      "system",
    ];
    channels.forEach((ch) => wsManager.subscribe(ch));
    return () => channels.forEach((ch) => wsManager.unsubscribe(ch));
  }, []);
  // Poll prices (every 5s via React Query)
  const { data: tickerData } = useAlpacaTicker(
    DEFAULT_WATCH_SYMBOLS.slice(0, 10),
  );

  // Feed polled ticker data into market store
  const prevTickerRef = useRef<string>("");
  useEffect(() => {
    if (!tickerData) return;
    const key = JSON.stringify(tickerData);
    if (key === prevTickerRef.current) return;
    prevTickerRef.current = key;
    marketStore.updatePrices(tickerData);
  }, [tickerData]);

  // Poll risk config and feed into store
  const { data: riskData } = useRiskConfig();
  useEffect(() => {
    if (!riskData) return;
    marketStore.updateRisk({
      gate: riskData.kill_switch ? "BLOCK" : "ALLOW",
      dailyLimit: riskData.max_daily_loss,
      maxPositions: riskData.max_concurrent_positions,
      killSwitch: riskData.kill_switch,
    });
  }, [riskData]);
  // Poll system status for pipeline state
  const { data: systemData } = useSystemStatus();
  useEffect(() => {
    if (!systemData?.pipeline) return;
    marketStore.updatePipeline(systemData.pipeline);
  }, [systemData]);

  return <>{children}</>;
}
