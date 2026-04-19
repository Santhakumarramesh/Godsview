import { ToDoBanner } from "@/components/ToDoBanner";

export default function LearningDriftPage() {
  return (
    <ToDoBanner
      title="Learning · Calibration drift"
      phase="Phase 8"
      description="Rolling reliability of confidence scores — Brier scores, ECE, and per-bucket realized vs. predicted. Triggers calibration retraining."
      related={[{ label: "Intelligence · Calibration", href: "/intel/calibration" }]}
    />
  );
}
