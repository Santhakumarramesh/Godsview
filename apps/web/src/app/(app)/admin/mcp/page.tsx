"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface McpTool {
  name: string;
  description: string;
  status: "active" | "disabled" | "error";
  lastInvoked: string | null;
  invokeCount: number;
}

export default function AdminMcpPage() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.mcp.listTools();
        const data = Array.isArray(res) ? res : res?.tools ?? res?.data ?? [];
        setTools(data);
      } catch (e) {
        // Mock fallback
        setTools([
          {
            name: "web_scraper",
            description: "Extract and parse web content from URLs",
            status: "active",
            lastInvoked: "2024-04-20T13:45:00Z",
            invokeCount: 342,
          },
          {
            name: "market_data_feed",
            description: "Stream real-time market data and price quotes",
            status: "active",
            lastInvoked: "2024-04-20T14:22:00Z",
            invokeCount: 5891,
          },
          {
            name: "news_aggregator",
            description: "Collect and index financial news from multiple sources",
            status: "active",
            lastInvoked: "2024-04-20T14:18:00Z",
            invokeCount: 1247,
          },
          {
            name: "slack_integration",
            description: "Send alerts and messages to Slack channels",
            status: "active",
            lastInvoked: "2024-04-20T14:20:00Z",
            invokeCount: 673,
          },
          {
            name: "email_notifier",
            description: "Send formatted email notifications for events",
            status: "disabled",
            lastInvoked: "2024-04-15T08:30:00Z",
            invokeCount: 189,
          },
          {
            name: "discord_bot",
            description: "Post updates to Discord servers",
            status: "error",
            lastInvoked: null,
            invokeCount: 0,
          },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async (toolName: string, newStatus: "active" | "disabled") => {
    setToggling(toolName);
    try {
      await api.mcp.updateTool(toolName, { status: newStatus });
      setTools(
        tools.map((t) => (t.name === toolName ? { ...t, status: newStatus } : t))
      );
    } catch (e) {
      setError(`Failed to update tool: ${toolName}`);
    } finally {
      setToggling(null);
    }
  };

  if (loading)
    return (
      <div className="p-6">
        <div className="animate-pulse h-8 bg-white/5 rounded w-48 mb-4" />
        <div className="animate-pulse h-64 bg-white/5 rounded" />
      </div>
    );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin · MCP Tools</h1>
        <p className="text-sm text-muted">
          MCP tool registry and invocation metrics. Enable or disable tools and monitor
          usage patterns across the control plane.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {tools.length === 0 ? (
        <div className="p-6 text-center text-muted rounded border border-border">
          No MCP tools configured.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Tool Name</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last Invoked</th>
                <th className="px-3 py-2 font-medium">Invokes</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.name} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{tool.name}</td>
                  <td className="px-3 py-2 text-muted">{tool.description}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        tool.status === "active"
                          ? "bg-green-500/20 text-green-300"
                          : tool.status === "disabled"
                            ? "bg-yellow-500/20 text-yellow-300"
                            : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {tool.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {tool.lastInvoked ? new Date(tool.lastInvoked).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-3 py-2 text-xs text-right">{tool.invokeCount}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() =>
                        handleToggle(
                          tool.name,
                          tool.status === "active" ? "disabled" : "active"
                        )
                      }
                      disabled={toggling === tool.name}
                      className={`px-2 py-1 text-xs rounded border ${
                        tool.status === "active"
                          ? "border-red-600/50 text-red-400 hover:bg-red-500/10"
                          : "border-green-600/50 text-green-400 hover:bg-green-500/10"
                      } disabled:opacity-50`}
                    >
                      {tool.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
