import { ToDoBanner } from "@/components/ToDoBanner";

export default function StrategiesActivePage() {
  return (
    <ToDoBanner
      title="Strategies · Active"
      phase="Phase 5"
      description="Strategies currently live or paper-trading with realtime PnL, exposure, and the last 20 decisions. Click a row to drill into per-trade reasoning."
      related={[{ label: "Execution · Orders", href: "/execution/orders" }]}
    />
  );
}
