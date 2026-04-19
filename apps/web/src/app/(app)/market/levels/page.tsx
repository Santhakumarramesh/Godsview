import { ToDoBanner } from "@/components/ToDoBanner";

export default function MarketLevelsPage() {
  return (
    <ToDoBanner
      title="Market · Levels"
      phase="Phase 2"
      description="Order blocks, fair-value gaps, prior-session highs/lows, and premium/discount zones rendered per symbol from the Market Structure Engine."
      related={[{ label: "Intelligence · Structure", href: "/intel/structure" }]}
    />
  );
}
