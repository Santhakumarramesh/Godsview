import { ToDoBanner } from "@/components/ToDoBanner";

export default function IntelSetupsPage() {
  return (
    <ToDoBanner
      title="Intelligence · Setups"
      phase="Phase 5"
      description="Live setup catalog — sweep+reclaim, OB retest, breakout+retest, FVG reaction — scored with RR, SL, TP from the Setup Detection Engine."
      related={[{ label: "Strategies · Catalog", href: "/strategies" }]}
    />
  );
}
