import { ToDoBanner } from "@/components/ToDoBanner";

export default function OpsDeploymentsPage() {
  return (
    <ToDoBanner
      title="Operations · Deployments"
      phase="Phase 1"
      description="Deployment ledger — every control plane / web / worker roll-out with git SHA, actor, duration, and rollback status."
    />
  );
}
