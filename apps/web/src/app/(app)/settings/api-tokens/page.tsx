import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

export default function SettingsApiTokensPage() {
  return (
    <ToDoBanner
      title="Settings · API tokens"
      phase="Phase 1"
      description="Personal access tokens — scoped, revocable, audit-logged. For scripting against the control plane API without juggling your login session."
      related={[{ label: "Admin · API keys", href: "/admin/api-keys" }]}
    />
  );
}
