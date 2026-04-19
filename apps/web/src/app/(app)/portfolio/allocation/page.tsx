import { ToDoBanner } from "@/components/ToDoBanner";

export default function PortfolioAllocationPage() {
  return (
    <ToDoBanner
      title="Portfolio · Allocation"
      phase="Phase 10"
      description="Capital allocation engine — per-strategy sizing informed by trust tier, regime fit, and recent calibration drift."
      related={[{ label: "Governance · Trust tiers", href: "/governance/trust" }]}
    />
  );
}
