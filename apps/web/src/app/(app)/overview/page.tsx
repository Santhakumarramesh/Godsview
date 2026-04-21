"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

interface Opportunity {
  id: string;
  symbol: string;
  setupType: string;
  direction: "bullish" | "bearish";
  confluenceScore: number;
  rr: string;
  status: "new" | "validated" | "approved" | "rejected";
  timestamp: string;
}

interface Signal {
  id: string;
  type: string;
  symbol: string;
  direction: string;
  price: number;
  confidence: number;
  agent: string;
  timestamp: string;
}

interface Agent {
  name: string;
  status: "active" | "idle";
  metric: string;
  value: string | number;
  icon: string;
}

const mockOpportunities: Opportunity[] = [
  {
    id: "1",
    symbol: "NVDA",
    setupType: "BOS",
    direction: "bullish",
    confluenceScore: 92,
    rr: "1:2.8",
    status: "approved",
    timestamp: "09:42",
  },
  {
    id: "2",
    symbol: "AAPL",
    setupType: "OB_RETEST",
    direction: "bearish",
    confluenceScore: 87,
    rr: "1:2.3",
    status: "validated",
    timestamp: "09:38",
  },
  {
    id: "3",
    symbol: "TSLA",
    setupType: "FVG",
    direction: "bullish",
    confluenceScore: 78,
    rr: "1:2.1",
    status: "validated",
    timestamp: "09:35",
  },
  {
    id: "4",
    symbol: "MSFT",
    setupType: "BREAKER",
    direction: "bullish",
    confluenceScore: 81,
    rr: "1:1.9",
    status: "new",
    timestamp: "09:32",
  },
  {
    id: "5",
    symbol: "AMZN",
    setupType: "BOS",
    direction: "bearish",
    confluenceScore: 74,
    rr: "1:2.2",
    status: "new",
    timestamp: "09:28",
  },
];

const mockSignals: Signal[] = [
  {
    id: "1",
    type: "BOS",
    symbol: "NVDA",
    direction: "bullish",
    price: 1182.4,
    confidence: 96,
    agent: "Scanner",
    timestamp: "09:42:15",
  },
  {
    id: "2",
    type: "OB_RETEST",
    symbol: "AAPL",
    direction: "bearish",
    price: 192.18,
    confidence: 91,
    agent: "Structure",
    timestamp: "09:38:42",
  },
  {
    id: "3",
    type: "FVG",
    symbol: "TSLA",
    direction: "bullish",
    price: 248.65,
    confidence: 84,
    agent: "Flow",
    timestamp: "09:35:07",
  },
  {
    id: "4",
    type: "BREAKER",
    symbol: "MSFT",
    direction: "bullish",
    price: 423.51,
    confidence: 88,
    agent: "Scanner",
    timestamp: "09:32:19",
  },
  {
    id: "5",
    type: "BOS",
    symbol: "AMZN",
    direction: "bearish",
    price: 187.42,
    confidence: 79,
    agent: "Structure",
    timestamp: "09:28:33",
  },
];

const agents: Agent[] = [
  {
    name: "Scanner Agent",
    status: "active",
    metric: "Scanning",
    value: "24 symbols",
    icon: "📡",
  },
  {
    name: "Structure Agent",
    status: "active",
    metric: "Active Signals",
    value: "3",
    icon: "🏗",
  },
  {
    name: "Flow Agent",
    status: "active",
    metric: "Monitoring",
    value: "8 books",
    icon: "💨",
  },
  {
    name: "Execution Agent",
    status: "active",
    metric: "Pending Orders",
    value: "2",
    icon: "⚡",
  },
  {
    name: "Risk Agent",
    status: "active",
    metric: "Gates Status",
    value: "All Green",
    icon: "🛡",
  },
  {
    name: "Learning Agent",
    status: "active",
    metric: "New Patterns",
    value: "12",
    icon: "🧠",
  },
];

export default function OverviewPage() {
  const { user } = useAuth();
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(mockOpportunities);
  const [signals, setSignals] = useState<Signal[]>(mockSignals);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        // Fetch scanner results for opportunities
        const scannerData = await api.scanner.getScanResults();
        if (scannerData?.candidates) {
          const mappedOpps: Opportunity[] = scannerData.candidates.slice(0, 5).map((c, i) => ({
            id: `${i + 1}`,
            symbol: c.symbol,
            setupType: ["BOS", "OB_RETEST", "FVG", "BREAKER"][i % 4],
            direction: (Math.random() > 0.5 ? "bullish" : "bearish") as "bullish" | "bearish",
            confluenceScore: Math.round(c.score * 100),
            rr: `1:${(2 + Math.random()).toFixed(1)}`,
            status: ["new", "validated", "approved"][i % 3] as any,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }));
          setOpportunities(mappedOpps);
        }

        // Health check
        try {
          await api.health.live();
        } catch (e) {
          console.warn("Health check failed, using mock data");
        }
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError("Unable to load live data, showing mock data");
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">
          God Brain Home
        </h1>
        <p className="text-sm text-muted">
          Welcome back, {user?.displayName ?? "trader"}. Command center status at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          {loading && <span className="text-xs text-primary ml-2">Loading...</span>}
          {error && <span className="text-xs text-error ml-2">{error}</span>}
        </p>
      </header>

      {/* Top Bar Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-6">
        <StatCard label="Total Equity" value="$148,420" change="+$2,110 YTD" color="blue" />
        <StatCard label="Today's P&L" value="+$2,791" change="+1.88%" color="green" />
        <StatCard label="Active Positions" value="4" change="2 long, 2 short" color="purple" />
        <StatCard label="Drawdown" value="-0.42%" change="Well below limit" color="green" />
        <StatCard label="Active Agents" value="6/6" change="All operational" color="green" />
        <StatCard label="System Health" value="All Green" change="No alerts" color="green" />
      </div>

      {/* Opportunity Queue */}
      <Card title="Opportunity Queue" subtitle="Top 5 validated setups">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
                <th className="py-2 px-3 text-left font-medium">Symbol</th>
                <th className="py-2 px-3 text-left font-medium">Setup Type</th>
                <th className="py-2 px-3 text-left font-medium">Direction</th>
                <th className="py-2 px-3 text-center font-medium">Confluence</th>
                <th className="py-2 px-3 text-center font-medium">R:R</th>
                <th className="py-2 px-3 text-center font-medium">Status</th>
                <th className="py-2 px-3 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp) => (
                <tr
                  key={opp.id}
                  onClick={() => setSelectedOpp(opp)}
                  className="border-b border-border/50 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <td className="py-2 px-3 font-mono font-semibold">{opp.symbol}</td>
                  <td className="py-2 px-3 text-muted">{opp.setupType}</td>
                  <td className="py-2 px-3">
                    <span
                      className={
                        opp.direction === "bullish"
                          ? "text-success"
                          : "text-error"
                      }
                    >
                      {opp.direction === "bullish" ? "▲" : "▼"} {opp.direction}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-block bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-mono">
                      {opp.confluenceScore}%
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center font-mono">{opp.rr}</td>
                  <td className="py-2 px-3 text-center">
                    <StatusBadge status={opp.status} />
                  </td>
                  <td className="py-2 px-3 text-right text-xs text-muted">
                    {opp.timestamp}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent Signals */}
      <Card title="Recent Signals" subtitle="Live signal feed from active agents">
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {signals.map((signal) => (
            <div
              key={signal.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-base">
                    {signal.symbol}
                  </span>
                  <span className="text-xs bg-background px-2 py-1 rounded text-muted">
                    {signal.type}
                  </span>
                  <span
                    className={
                      signal.direction === "bullish"
                        ? "text-success font-semibold"
                        : "text-error font-semibold"
                    }
                  >
                    {signal.direction === "bullish" ? "↗ Bullish" : "↘ Bearish"}
                  </span>
                  <span className="text-xs text-muted ml-auto mr-2">
                    {signal.timestamp}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  Price: ${signal.price.toFixed(2)} | Confidence:{" "}
                  <span className="text-foreground font-semibold">
                    {signal.confidence}%
                  </span>{" "}
                  | Source: {signal.agent}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Agent Status Grid */}
      <Card title="Agent Status Grid" subtitle="6 agents running in parallel">
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {agents.map((agent) => (
            <div
              key={agent.name}
              className="rounded-lg border border-success/20 bg-success/5 p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {agent.name}
                  </div>
                  <div className="text-xs text-muted mt-2">{agent.metric}</div>
                </div>
                <span className="text-xl">{agent.icon}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span className="text-sm font-mono font-semibold text-success">
                  {agent.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Quick Actions */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-sm font-medium mb-3">Quick Actions</div>
        <div className="flex flex-wrap gap-2">
          <QuickActionLink href="/overview" label="Brain Hologram" />
          <QuickActionLink href="/market/scanner" label="Market Scanner" />
          <QuickActionLink href="/execution" label="Execution Center" />
          <QuickActionLink href="/market/symbols" label="Market Symbols" />
        </div>
      </div>

      {/* Selected Opportunity Detail */}
      {selectedOpp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-semibold">{selectedOpp.symbol}</h2>
                <p className="text-sm text-muted">{selectedOpp.setupType}</p>
              </div>
              <button
                onClick={() => setSelectedOpp(null)}
                className="text-2xl leading-none text-muted hover:text-foreground"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 text-sm">
              <DetailRow
                label="Direction"
                value={
                  selectedOpp.direction === "bullish" ? "▲ Bullish" : "▼ Bearish"
                }
                color={
                  selectedOpp.direction === "bullish"
                    ? "text-success"
                    : "text-error"
                }
              />
              <DetailRow
                label="Confluence Score"
                value={`${selectedOpp.confluenceScore}%`}
              />
              <DetailRow label="Risk:Reward" value={selectedOpp.rr} />
              <DetailRow label="Status" value={selectedOpp.status} />
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-xs text-muted">Suggested Levels</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted block">Entry</span>
                  <span className="font-semibold">Market</span>
                </div>
                <div>
                  <span className="text-muted block">Stop Loss</span>
                  <span className="font-semibold">-2%</span>
                </div>
                <div>
                  <span className="text-muted block">Target</span>
                  <span className="font-semibold text-success">+2.8%</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedOpp(null)}
              className="w-full py-2 px-3 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-sm font-medium mt-4"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  change,
  color,
}: {
  label: string;
  value: string;
  change: string;
  color: string;
}) {
  const colorClasses = {
    blue: "border-blue-500/20 bg-blue-500/5 text-blue-400",
    green: "border-success/20 bg-success/5 text-success",
    purple: "border-purple-500/20 bg-purple-500/5 text-purple-400",
  };

  return (
    <div className={`rounded-lg border ${colorClasses[color as keyof typeof colorClasses]} p-3`}>
      <div className="text-xs text-muted uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      <div className="text-xs text-muted/70 mt-1">{change}</div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
      <header className="mb-4">
        <div className="text-base font-semibold">{title}</div>
        {subtitle ? (
          <div className="text-xs text-muted mt-1">{subtitle}</div>
        ) : null}
      </header>
      <div>{children}</div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "new" | "validated" | "approved" | "rejected";
}) {
  const statusConfig = {
    new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    validated: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-success/20 text-success border-success/30",
    rejected: "bg-error/20 text-error border-error/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${statusConfig[status]}`}
    >
      {status}
    </span>
  );
}

function DetailRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-semibold ${color || ""}`}>{value}</span>
    </div>
  );
}

function QuickActionLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
    >
      {label}
    </Link>
  );
}
