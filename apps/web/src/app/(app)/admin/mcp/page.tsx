import { ToDoBanner } from "@/components/ToDoBanner";

export default function AdminMcpPage() {
  return (
    <ToDoBanner
      title="Admin · MCP servers"
      phase="Phase 1"
      description="Register and health-check MCP servers — TradingView signal bridge, execution adapters, data feeds. Per-server state and last-handshake timestamp."
    />
  );
}
