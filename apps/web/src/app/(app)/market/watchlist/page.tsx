import { ToDoBanner } from "@/components/ToDoBanner";

export default function MarketWatchlistPage() {
  return (
    <ToDoBanner
      title="Market · Watchlist"
      phase="Phase 2"
      description="User-curated watchlist with live quote feed, BOS/CHOCH overlays, and per-symbol confidence glow once the Market Structure Engine is online."
      related={[{ label: "Market · Symbols", href: "/market/symbols" }]}
    />
  );
}
