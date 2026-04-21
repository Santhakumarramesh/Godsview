import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.feeds API
async function getFeeds() {
  try {
    const data = await api.ops.getFeeds().catch(() => ({ feeds: [] }))
    return data
  } catch (err) {
    return { feeds: [] }
  }
}

export default function OpsFeedsPage() {
  return (
    <ToDoBanner
      title="Operations · Feeds"
      phase="Phase 2"
      description="Data Truth & Latency Monitor — per-feed health, gap detection, freshness, and an auto-disable guard when reliability drops."
    />
  );
}
