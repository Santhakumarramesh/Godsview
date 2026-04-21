import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.trustTiers API
async function getTrustTiers() {
  try {
    const data = await api.audit.getTrustTiers().catch(() => ({ tiers: [] }))
    return data
  } catch (err) {
    return { tiers: [] }
  }
}

export default function GovernanceTrustPage() {
  return (
    <ToDoBanner
      title="Governance · Trust tiers"
      phase="Phase 11"
      description="Per-strategy trust tier — Tier A autonomous, Tier B assisted, Tier C paper. Drives execution sizing and approval gates."
      related={[{ label: "Governance · Demotions", href: "/governance/demotions" }]}
    />
  );
}
