import { ToDoBanner } from "@/components/ToDoBanner";

export default function StrategiesCatalogPage() {
  return (
    <ToDoBanner
      title="Strategies · Catalog"
      phase="Phase 5"
      description="The full strategy library — promoted live, paper-trading, experimental — with tier badges, owners, win-rate, and last-touched timestamps."
      related={[
        { label: "Strategies · Builder", href: "/strategies/builder" },
        { label: "Strategies · Active", href: "/strategies/active" },
      ]}
    />
  );
}
