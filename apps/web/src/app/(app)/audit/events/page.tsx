import { ToDoBanner } from "@/components/ToDoBanner";

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
