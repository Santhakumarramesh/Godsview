import { ToDoBanner } from "@/components/ToDoBanner";

export default function AdminApiKeysPage() {
  return (
    <ToDoBanner
      title="Admin · API keys"
      phase="Phase 1"
      description="Issue, rotate, and revoke programmatic API keys with fine-grained scopes. Last-used timestamps and rate-limit bucket assignment shown per key."
    />
  );
}
