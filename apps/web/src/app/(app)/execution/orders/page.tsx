import { ToDoBanner } from "@/components/ToDoBanner";

export default function ExecutionOrdersPage() {
  return (
    <ToDoBanner
      title="Execution · Orders"
      phase="Phase 9"
      description="Live order blotter from the Alpaca execution adapter — market, limit, bracket — with per-order state, attempts, and latency breakdown."
      related={[{ label: "Execution · Fills", href: "/execution/fills" }]}
    />
  );
}
