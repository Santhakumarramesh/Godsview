import { ToDoBanner } from "@/components/ToDoBanner";

export default function QuantRankingPage() {
  return (
    <ToDoBanner
      title="Quant Lab · Ranking"
      phase="Phase 6"
      description="Strategy ranking and tier assignment — Tier A (live), Tier B (paper), Tier C (experimental) — derived from rolling, regime-aware metrics."
      related={[{ label: "Strategies · Promotions", href: "/strategies/promotions" }]}
    />
  );
}
