import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.deployments API
async function getDeployments() {
  try {
    const data = await api.ops.getDeployments().catch(() => ({ deployments: [] }))
    return data
  } catch (err) {
    return { deployments: [] }
  }
}

export default function OpsDeploymentsPage() {
  return (
    <ToDoBanner
      title="Operations · Deployments"
      phase="Phase 1"
      description="Deployment ledger — every control plane / web / worker roll-out with git SHA, actor, duration, and rollback status."
    />
  );
}
