import { ToDoBanner } from "@/components/ToDoBanner";

export default function IntelFusionPage() {
  return (
    <ToDoBanner
      title="Intelligence · Fusion"
      phase="Phase 4"
      description="Combines structure, order flow, regime, and macro context into a single weighted confidence score with conflict-resolution rationale."
      related={[
        { label: "Intelligence · Structure", href: "/intel/structure" },
        { label: "Intelligence · Order flow", href: "/intel/flow" },
      ]}
    />
  );
}
