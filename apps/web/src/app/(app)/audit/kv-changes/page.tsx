import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.kvChanges API
async function getKvChanges() {
  try {
    const data = await api.audit.getKvChanges().catch(() => ({ changes: [] }))
    return data
  } catch (err) {
    return { changes: [] }
  }
}

export default function AuditKvChangesPage() {
  return (
    <ToDoBanner
      title="Audit · KV changes"
      phase="Phase 1"
      description="Feature flag + system config mutation history. Every toggle and value change is recorded with actor, reason, and diff."
    />
  );
}
