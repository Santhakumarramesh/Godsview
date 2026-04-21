import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire risk.policies API
async function getPolicies() {
  try {
    const data = await api.risk.getPolicies().catch(() => ({ policies: [] }))
    return data
  } catch (err) {
    return { policies: [] }
  }
}

export default function GovernancePoliciesPage() {
  return (
    <ToDoBanner
      title="Governance · Policies"
      phase="Phase 11"
      description="Policy authoring — approval workflows, anomaly thresholds, dual-control rules. All edits audit-logged with diffs."
    />
  );
}
