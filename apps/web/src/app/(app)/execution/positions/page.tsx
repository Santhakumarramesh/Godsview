import { ToDoBanner } from "@/components/ToDoBanner";

export default function ExecutionPositionsPage() {
  return (
    <ToDoBanner
      title="Execution · Positions"
      phase="Phase 9"
      description="Open positions across accounts with realtime mark-to-market, unrealized PnL, and the strategy/decision that opened each leg."
      related={[{ label: "Portfolio · PnL", href: "/portfolio/pnl" }]}
    />
  );
}
