import { ToDoBanner } from "@/components/ToDoBanner";

export default function OpsLatencyPage() {
  return (
    <ToDoBanner
      title="Operations · Latency"
      phase="Phase 1"
      description="End-to-end latency — webhook → signal → decision → broker → ack — broken down by stage, percentile, and venue."
    />
  );
}
