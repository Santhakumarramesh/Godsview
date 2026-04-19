import { ToDoBanner } from "@/components/ToDoBanner";

export default function ReplayPage() {
  return (
    <ToDoBanner
      title="Command · Replay"
      phase="Phase 6"
      description="Time-travel the market candle-by-candle and re-run GodsView's reasoning at any historical bar. Powered by the Quant Lab Replay Engine."
      related={[
        { label: "Quant Lab · Replay", href: "/quant/replay" },
        { label: "Overview", href: "/overview" },
      ]}
    />
  );
}
