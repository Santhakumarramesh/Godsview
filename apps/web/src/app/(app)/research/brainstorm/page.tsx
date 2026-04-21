import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function ResearchBrainstormPage() {
  return (
    <ToDoBanner
      title="Research · Brainstorm"
      phase="Phase 6"
      description="Free-form research workspace — prompt the agents to draft new strategy hypotheses, propose filters, or explain regime quirks."
    />
  );
}
