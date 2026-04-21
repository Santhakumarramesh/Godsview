import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function MarketSessionsPage() {
  return (
    <ToDoBanner
      title="Market · Sessions"
      phase="Phase 2"
      description="London / New York / Asia session windows, killzone overlays, and session-volatility heatmaps from the Session Intelligence engine."
    />
  );
}
