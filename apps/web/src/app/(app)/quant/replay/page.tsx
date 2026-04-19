import { ToDoBanner } from "@/components/ToDoBanner";

export default function QuantReplayPage() {
  return (
    <ToDoBanner
      title="Quant Lab · Replay"
      phase="Phase 6"
      description="Candle-by-candle replay engine — rewind any market session and ask 'what would GodsView do here?' with full agent-vote audit trail."
      related={[{ label: "Command · Replay", href: "/replay" }]}
    />
  );
}
