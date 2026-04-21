import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire audit.demotions API
async function getDemotions() {
  try {
    const data = await api.audit.getDemotions().catch(() => ({ demotions: [] }))
    return data
  } catch (err) {
    return { demotions: [] }
  }
}

export default function GovernanceDemotionsPage() {
  return (
    <ToDoBanner
      title="Governance · Demotions"
      phase="Phase 11"
      description="Auto-demotion log — strategies kicked down a tier by SLO breach, drawdown, anomaly detection, or calibration drift."
    />
  );
}
