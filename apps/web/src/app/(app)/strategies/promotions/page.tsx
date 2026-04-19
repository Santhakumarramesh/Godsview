import { ToDoBanner } from "@/components/ToDoBanner";

export default function StrategiesPromotionsPage() {
  return (
    <ToDoBanner
      title="Strategies · Promotions"
      phase="Phase 6"
      description="Quant Lab → Paper → Assisted Live → Autonomous promotion pipeline with auto-demotion triggers when SLOs or drawdown thresholds breach."
      related={[{ label: "Governance · Trust tiers", href: "/governance/trust" }]}
    />
  );
}
