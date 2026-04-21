import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire ops.latency API
async function getLatency() {
  try {
    const data = await api.ops.getLatency().catch(() => ({ latency: [] }))
    return data
  } catch (err) {
    return { latency: [] }
  }
}

export default function OpsLatencyPage() {
  return (
    <ToDoBanner
      title="Operations · Latency"
      phase="Phase 1"
      description="End-to-end latency — webhook → signal → decision → broker → ack — broken down by stage, percentile, and venue."
    />
  );
}
