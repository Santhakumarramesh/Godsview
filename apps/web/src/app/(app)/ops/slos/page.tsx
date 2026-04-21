import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.slos API
async function getSlos() {
  try {
    const data = await api.ops.getSlos().catch(() => ({ slos: [] }))
    return data
  } catch (err) {
    return { slos: [] }
  }
}

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
