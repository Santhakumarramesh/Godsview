import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.events API
async function getAuditEvents() {
  try {
    const data = await api.audit.getEvents().catch(() => ({ events: [] }))
    return data
  } catch (err) {
    return { events: [] }
  }
}

export default function AuditEventsPage() {
  return (
    <ToDoBanner
      title="Audit · Events"
      phase="Phase 1"
      description="Full audit event log — actor, action, resource, before/after snapshots, correlation ID. Write-once, immutable."
      related={[{ label: "Audit · KV changes", href: "/audit/kv-changes" }]}
    />
  );
}
