import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.incidents API
async function getIncidents() {
  try {
    const data = await api.ops.getIncidents().catch(() => ({ incidents: [] }))
    return data
  } catch (err) {
    return { incidents: [] }
  }
}

export default function OpsIncidentsPage() {
  return (
    <ToDoBanner
      title="Operations · Incidents"
      phase="Phase 1"
      description="Incident timeline, status, commander, and blameless postmortem links."
    />
  );
}
