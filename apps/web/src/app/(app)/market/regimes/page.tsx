import { ToDoBanner } from "@/components/ToDoBanner";

export default function MarketRegimesPage() {
  return (
    <ToDoBanner
      title="Market · Regimes"
      phase="Phase 4"
      description="Regime classification per symbol — trending, ranging, volatile, news-driven — produced by the Regime Detection Engine and consumed by the Fusion brain."
      related={[
        { label: "Intelligence · Fusion", href: "/intel/fusion" },
        { label: "Research · Regimes", href: "/research/regimes" },
      ]}
    />
  );
}
