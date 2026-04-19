import { ToDoBanner } from "@/components/ToDoBanner";

export default function QuantBacktestsPage() {
  return (
    <ToDoBanner
      title="Quant Lab · Backtests"
      phase="Phase 6"
      description="Multi-timeframe backtest runner with realistic fills, slippage, latency modeling, and equity-curve plots."
      related={[{ label: "Quant Lab · Metrics", href: "/quant/metrics" }]}
    />
  );
}
