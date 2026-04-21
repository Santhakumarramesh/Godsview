import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function IntelCalibrationPage() {
  return (
    <ToDoBanner
      title="Intelligence · Calibration"
      phase="Phase 8"
      description="Confidence calibration curves — adjusts predicted probabilities based on rolling realized accuracy from the Confidence Calibration Engine."
      related={[{ label: "Learning · Calibration drift", href: "/learning/drift" }]}
    />
  );
}
