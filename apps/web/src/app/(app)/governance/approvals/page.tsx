import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.approvals API
async function getApprovals() {
  try {
    const data = await api.audit.getApprovals().catch(() => ({ approvals: [] }))
    return data
  } catch (err) {
    return { approvals: [] }
  }
}

export default function GovernanceApprovalsPage() {
  return (
    <ToDoBanner
      title="Governance · Approvals"
      phase="Phase 11"
      description="Pending approval queue — strategy promotions, threshold changes, kill-switch bypass requests. Dual-control gating for high-risk actions."
    />
  );
}
