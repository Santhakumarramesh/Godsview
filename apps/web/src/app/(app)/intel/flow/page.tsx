import { ToDoBanner } from "@/components/ToDoBanner";

export default function IntelOrderFlowPage() {
  return (
    <ToDoBanner
      title="Intelligence · Order flow"
      phase="Phase 3"
      description="Real-time delta, imbalance, absorption, and continuation-probability scoring from the Order Flow Engine."
      related={[{ label: "Market · Liquidity", href: "/market/liquidity" }]}
    />
  );
}
