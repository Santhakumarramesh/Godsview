import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function PortfolioExposurePage() {
  return (
    <ToDoBanner
      title="Portfolio · Exposure"
      phase="Phase 10"
      description="Per-asset, per-sector, per-venue exposure — long/short, notional, beta-adjusted — with concentration alerts."
    />
  );
}
