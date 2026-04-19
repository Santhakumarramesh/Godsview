import { ToDoBanner } from "@/components/ToDoBanner";

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
