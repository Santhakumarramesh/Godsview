import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function ResearchRegimesPage() {
  return (
    <ToDoBanner
      title="Research · Regimes"
      phase="Phase 4"
      description="Historical regime atlas — per-symbol regime transition probabilities, dwell times, and per-regime strategy fitness."
      related={[{ label: "Market · Regimes", href: "/market/regimes" }]}
    />
  );
}
