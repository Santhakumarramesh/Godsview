import { ToDoBanner } from "@/components/ToDoBanner";

export default function AdminWebhooksPage() {
  return (
    <ToDoBanner
      title="Admin · Webhooks"
      phase="Phase 1"
      description="Webhook endpoints, HMAC secrets, delivery attempts, and replay tooling for TradingView MCP + partner integrations."
    />
  );
}
