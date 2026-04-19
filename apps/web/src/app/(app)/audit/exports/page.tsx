import { ToDoBanner } from "@/components/ToDoBanner";

export default function AuditExportsPage() {
  return (
    <ToDoBanner
      title="Audit · Exports"
      phase="Phase 1"
      description="Export audit data for compliance or investigation — signed CSV / JSONL bundles with date range and resource filters."
    />
  );
}
