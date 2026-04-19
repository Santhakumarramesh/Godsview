import { ToDoBanner } from "@/components/ToDoBanner";

export default function OpsSlosPage() {
  return (
    <ToDoBanner
      title="Operations · SLOs"
      phase="Phase 1"
      description="Service-level objectives — availability, latency, error budgets, burn rates — per surface and dependency."
      related={[{ label: "Operations · Alerts", href: "/ops/alerts" }]}
    />
  );
}
