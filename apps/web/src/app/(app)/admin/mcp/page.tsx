import { ToDoBanner } from "@/components/ToDoBanner";
import { api } from "@/lib/api";

// Wire mcp API
async function getMcpServers() {
  try {
    const data = await api.mcp.list().catch(() => ({ servers: [] }))
    return data
  } catch (err) {
    return { servers: [] }
  }
}

export default function AdminMcpPage() {
  return (
    <ToDoBanner
      title="Admin · MCP servers"
      phase="Phase 1"
      description="Register and health-check MCP servers — TradingView signal bridge, execution adapters, data feeds. Per-server state and last-handshake timestamp."
    />
  );
}
