import { ToDoBanner } from "@/components/ToDoBanner";

export default function ExecutionKillSwitchPage() {
  return (
    <ToDoBanner
      title="Execution · Kill switch"
      phase="Phase 9"
      description="Global execution halt. Triggers on config, SLO breach, or manual operator action. Defaults to ENABLED by the Phase 0 safety floor (Decision #4)."
      related={[
        { label: "Operations · Flags", href: "/ops/flags" },
        { label: "Admin · System config", href: "/admin/system" },
      ]}
    />
  );
}
