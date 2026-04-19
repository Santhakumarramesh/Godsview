import { ToDoBanner } from "@/components/ToDoBanner";

export default function MarketLiquidityPage() {
  return (
    <ToDoBanner
      title="Market · Liquidity"
      phase="Phase 3"
      description="Liquidity walls, volume clusters, absorption and exhaustion footprints sourced from the Order Flow Engine (Bookmap-style depth feed)."
      related={[{ label: "Intelligence · Order flow", href: "/intel/flow" }]}
    />
  );
}
