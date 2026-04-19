import { ToDoBanner } from "@/components/ToDoBanner";

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
