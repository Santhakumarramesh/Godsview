import { ToDoBanner } from "@/components/ToDoBanner";

export default function ExecutionRiskPage() {
  return (
    <ToDoBanner
      title="Execution · Risk"
      phase="Phase 9"
      description="Max drawdown, daily loss cap, exposure limits, and correlation guardrails from the Risk Engine — with real-time utilization meters."
      related={[{ label: "Execution · Kill switch", href: "/execution/killswitch" }]}
    />
  );
}
