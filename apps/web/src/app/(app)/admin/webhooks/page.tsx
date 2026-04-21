import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire webhooks API
async function getWebhooks() {
  try {
    const data = await api.webhooks.list().catch(() => ({ webhooks: [] }))
    return data
  } catch (err) {
    return { webhooks: [] }
  }
}

export default function AdminWebhooksPage() {
  return (
    <ToDoBanner
      title="Admin · Webhooks"
      phase="Phase 1"
      description="Webhook endpoints, HMAC secrets, delivery attempts, and replay tooling for TradingView MCP + partner integrations."
    />
  );
}
