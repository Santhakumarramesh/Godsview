import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire apiKeys API
async function getApiKeys() {
  try {
    const data = await api.apiKeys.list().catch(() => ({ keys: [] }))
    return data
  } catch (err) {
    return { keys: [] }
  }
}

export default function AdminApiKeysPage() {
  return (
    <ToDoBanner
      title="Admin · API keys"
      phase="Phase 1"
      description="Issue, rotate, and revoke programmatic API keys with fine-grained scopes. Last-used timestamps and rate-limit bucket assignment shown per key."
    />
  );
}
