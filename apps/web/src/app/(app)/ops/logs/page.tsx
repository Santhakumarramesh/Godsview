import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.logs API
async function getLogs() {
  try {
    const data = await api.ops.getLogs().catch(() => ({ logs: [] }))
    return data
  } catch (err) {
    return { logs: [] }
  }
}

export default function OpsLogsPage() {
  return (
    <ToDoBanner
      title="Operations · Logs"
      phase="Phase 1"
      description="Structured log tail with correlation-ID search, severity filter, and jump-to-audit-event linking."
      related={[{ label: "Audit · Events", href: "/audit/events" }]}
    />
  );
}
