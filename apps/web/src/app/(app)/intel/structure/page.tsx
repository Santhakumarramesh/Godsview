import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function IntelStructurePage() {
  return (
    <ToDoBanner
      title="Intelligence · Structure"
      phase="Phase 2"
      description="Live BOS / CHOCH / OB / FVG state per symbol with multi-timeframe alignment, sourced from the Market Structure Engine and the TradingView MCP layer."
      related={[{ label: "Market · Levels", href: "/market/levels" }]}
    />
  );
}
