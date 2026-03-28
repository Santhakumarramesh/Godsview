import { useGetSystemStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { cn, getStatusColor } from "@/lib/utils";
import { Cpu, Terminal, ShieldAlert, Activity, GitBranch, Brain, Settings2, RefreshCcw, Wifi, WifiOff, AlertCircle } from "lucide-react";
import { format } from "date-fns";

type DiagnosticsLayer = { status: "live" | "degraded" | "offline"; detail: string };
type Diagnostics = {
  system_status: string;
  timestamp: string;
  layers: Record<string, DiagnosticsLayer>;
  recommendations: string[];
};

const LAYER_LABELS: Record<string, string> = {
  data_feed: "Data Feed (Alpaca)",
  trading_api: "Trading API Keys",
  strategy_engine: "Strategy Engine",
  database: "PostgreSQL Database",
  recall_engine: "Recall / Accuracy DB",
  ml_model: "ML Model Layer",
  claude_reasoning: "Claude Reasoning Layer",
};

const LAYER_ICONS: Record<string, React.ReactNode> = {
  data_feed: <Activity className="w-4 h-4" />,
  trading_api: <Wifi className="w-4 h-4" />,
  strategy_engine: <GitBranch className="w-4 h-4" />,
  database: <Cpu className="w-4 h-4" />,
  recall_engine: <Brain className="w-4 h-4" />,
  ml_model: <Settings2 className="w-4 h-4" />,
  claude_reasoning: <Terminal className="w-4 h-4" />,
};

function StatusDot({ status }: { status: string }) {
  if (status === "live") return <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />;
  if (status === "degraded") return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />;
}

export default function System() {
  const { data, isLoading } = useGetSystemStatus();
  const { data: diag, isLoading: diagLoading, refetch: refetchDiag } = useQuery<Diagnostics>({
    queryKey: ["diagnostics"],
    queryFn: () => fetch("/api/system/diagnostics").then((r) => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-full"><RefreshCcw className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const getLayerIcon = (name: string) => {
    if (name.includes('TradingView')) return <Activity className="w-6 h-6" />;
    if (name.includes('Order Flow')) return <GitBranch className="w-6 h-6" />;
    if (name.includes('Recall')) return <Brain className="w-6 h-6" />;
    if (name.includes('ML')) return <Cpu className="w-6 h-6" />;
    if (name.includes('Claude')) return <Terminal className="w-6 h-6" />;
    if (name.includes('Risk')) return <ShieldAlert className="w-6 h-6" />;
    return <Settings2 className="w-6 h-6" />;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Core</h1>
        <p className="text-muted-foreground mt-1">Status diagnostics for the 6-layer reasoning engine.</p>
      </div>

      {/* Hero Status */}
      <Card className="bg-card/40 backdrop-blur-md border border-border shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden relative">
        <div className={cn(
          "absolute top-0 left-0 w-1 h-full",
          data.overall === 'healthy' ? "bg-success shadow-[0_0_20px_var(--color-success)]" : "bg-destructive shadow-[0_0_20px_var(--color-destructive)]"
        )} />
        <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-1">Global Status</h2>
            <div className="flex items-center gap-3">
              <span className={cn(
                "w-4 h-4 rounded-full animate-pulse",
                data.overall === 'healthy' ? "bg-success" : "bg-destructive"
              )} />
              <span className="text-4xl font-bold uppercase tracking-tight text-foreground">
                {data.overall}
              </span>
            </div>
          </div>
          
          <div className="flex gap-8">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Active Target</p>
              <p className="text-xl font-mono-num font-bold text-primary">{data.active_instrument || "Awaiting Scan"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Session</p>
              <p className="text-xl font-bold">{data.active_session || "None"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* News Lockout Banner */}
      {data.news_lockout_active && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-center gap-4 animate-pulse">
          <div className="p-2 bg-destructive/20 rounded-full text-destructive">
             <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-destructive font-bold text-lg">NEWS LOCKOUT ACTIVE</h3>
            <p className="text-destructive/80 text-sm">Trading disabled due to high-impact economic events.</p>
          </div>
        </div>
      )}

      {/* Live Diagnostics */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" /> Live Layer Diagnostics
          </h3>
          <button
            onClick={() => refetchDiag()}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-white/5 transition-colors"
          >
            <RefreshCcw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {diagLoading && (
          <div className="text-center text-muted-foreground py-8"><RefreshCcw className="w-5 h-5 animate-spin mx-auto" /></div>
        )}

        {diag && (
          <div className="space-y-3">
            {/* System status summary */}
            <div className={cn(
              "rounded-xl px-5 py-3 flex items-center justify-between border",
              diag.system_status === "healthy" ? "bg-emerald-500/10 border-emerald-500/30" :
              diag.system_status === "partial" ? "bg-amber-500/10 border-amber-500/30" :
              "bg-red-500/10 border-red-500/30"
            )}>
              <div className="flex items-center gap-2">
                <StatusDot status={diag.system_status === "healthy" ? "live" : diag.system_status === "partial" ? "degraded" : "offline"} />
                <span className="font-semibold uppercase tracking-wider text-sm">
                  System {diag.system_status}
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{new Date(diag.timestamp).toLocaleTimeString()}</span>
            </div>

            {/* Layer cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(diag.layers).map(([key, layer]) => (
                <div
                  key={key}
                  className={cn(
                    "rounded-xl p-4 border flex items-start gap-3",
                    layer.status === "live" ? "bg-emerald-500/5 border-emerald-500/20" :
                    layer.status === "degraded" ? "bg-amber-500/5 border-amber-500/20" :
                    "bg-red-500/5 border-red-500/20"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-lg flex-shrink-0 mt-0.5",
                    layer.status === "live" ? "bg-emerald-500/15 text-emerald-400" :
                    layer.status === "degraded" ? "bg-amber-500/15 text-amber-400" :
                    "bg-red-500/15 text-red-400"
                  )}>
                    {LAYER_ICONS[key] ?? <Settings2 className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusDot status={layer.status} />
                      <span className="text-sm font-semibold">{LAYER_LABELS[key] ?? key}</span>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                        layer.status === "live" ? "text-emerald-400 bg-emerald-400/10" :
                        layer.status === "degraded" ? "text-amber-400 bg-amber-400/10" :
                        "text-red-400 bg-red-400/10"
                      )}>{layer.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{layer.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Recommendations */}
            {diag.recommendations.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-400" /> Recommendations
                </div>
                <ul className="space-y-2">
                  {diag.recommendations.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-amber-400 mt-0.5 flex-shrink-0">→</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Layer Details */}
      <div>
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" /> Pipeline Layers
        </h3>
        <div className="space-y-3">
          {data.layers.map((layer, index) => (
             <div key={layer.name} className="flex flex-col sm:flex-row gap-4 bg-card border border-border/50 rounded-xl p-4 hover:bg-muted/20 transition-colors group">
               <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-background border border-border shadow-inner relative">
                 <div className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center text-[10px] font-mono-num text-muted-foreground">
                   {index + 1}
                 </div>
                 <div className="text-muted-foreground group-hover:text-primary transition-colors">
                   {getLayerIcon(layer.name)}
                 </div>
               </div>
               
               <div className="flex-1 flex flex-col justify-center">
                 <div className="flex items-center justify-between">
                   <h4 className="font-bold text-foreground text-lg">{layer.name}</h4>
                   <span className={cn("px-2.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider", getStatusColor(layer.status))}>
                     {layer.status}
                   </span>
                 </div>
                 <p className="text-sm text-muted-foreground mt-1">{layer.message}</p>
               </div>

               {layer.last_update && (
                 <div className="flex-shrink-0 flex items-end justify-end sm:justify-center">
                   <span className="text-xs font-mono-num text-muted-foreground">
                     Ping: {format(new Date(layer.last_update), 'HH:mm:ss.SSS')}
                   </span>
                 </div>
               )}
             </div>
          ))}
        </div>
      </div>
    </div>
  );
}
