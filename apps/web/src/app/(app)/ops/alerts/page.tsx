import { ToDoBanner } from "@/components/ToDoBanner";

export default function OpsAlertsPage() {
  return (
    <ToDoBanner
      title="Operations · Alerts"
      phase="Phase 1"
      description="Active + recent alerts with channel routing (PagerDuty, Slack, email) and per-rule silence windows."
    />
  );
}
