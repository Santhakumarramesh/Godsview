import { ToDoBanner } from "@/components/ToDoBanner";

export default function LearningMissedPage() {
  return (
    <ToDoBanner
      title="Learning · Missed trades"
      phase="Phase 7"
      description="Detected setups that weren't taken — with hindsight gain/loss, reason for skipping, and a 'would-have-been' equity contribution."
      related={[{ label: "Intelligence · Recall", href: "/intel/recall" }]}
    />
  );
}
