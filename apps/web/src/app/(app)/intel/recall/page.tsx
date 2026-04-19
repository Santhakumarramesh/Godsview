import { ToDoBanner } from "@/components/ToDoBanner";

export default function IntelRecallPage() {
  return (
    <ToDoBanner
      title="Intelligence · Recall"
      phase="Phase 7"
      description="Similarity search across past trades and chart screenshots — surfaces the historical setups that most resemble the current state, plus their outcomes."
      related={[{ label: "Learning · Missed trades", href: "/learning/missed" }]}
    />
  );
}
