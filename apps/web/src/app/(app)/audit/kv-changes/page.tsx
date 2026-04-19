import { ToDoBanner } from "@/components/ToDoBanner";

export default function AuditKvChangesPage() {
  return (
    <ToDoBanner
      title="Audit · KV changes"
      phase="Phase 1"
      description="Feature flag + system config mutation history. Every toggle and value change is recorded with actor, reason, and diff."
    />
  );
}
