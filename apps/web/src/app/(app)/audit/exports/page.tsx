import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.exports API
async function getAuditExports() {
  try {
    const data = await api.audit.getExports().catch(() => ({ exports: [] }))
    return data
  } catch (err) {
    return { exports: [] }
  }
}

export default function AuditExportsPage() {
  return (
    <ToDoBanner
      title="Audit · Exports"
      phase="Phase 1"
      description="Export audit data for compliance or investigation — signed CSV / JSONL bundles with date range and resource filters."
    />
  );
}
