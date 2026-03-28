import { useGetSystemStatus, useGetPerformance, useGetSignals } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent, getStatusColor, cn } from "@/lib/utils";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, RefreshCcw, TrendingUp, XCircle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: systemStatus, isLoading: sysLoading } = useGetSystemStatus();
  const { data: performance, isLoading: perfLoading } = useGetPerformance({ days: 1 });
  const { data: signals, isLoading: sigLoading } = useGetSignals({ limit: 5 });

  if (sysLoading || perfLoading || sigLoading) {
    return <div className="flex items-center justify-center h-full"><RefreshCcw className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Mission Control</h1>
        <div className="flex items-center gap-2">
          {systemStatus?.news_lockout_active && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
              <AlertTriangle className="w-4 h-4" />
              News Lockout Active
            </div>
          )}
          <div className="px-3 py-1 rounded-full bg-secondary border border-border text-sm font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            {systemStatus?.active_instrument || "Waiting"} | {systemStatus?.active_session || "Pre-session"}
          </div>
        </div>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Today's P&L", value: formatCurrency(performance?.total_pnl), sub: `${performance?.total_trades || 0} trades`, highlight: (performance?.total_pnl || 0) >= 0 },
          { label: "Win Rate (24h)", value: formatPercent(performance?.win_rate), sub: "Target > 60%", highlight: (performance?.win_rate || 0) > 60 },
          { label: "Expectancy", value: formatCurrency(performance?.expectancy), sub: "Per trade average", highlight: (performance?.expectancy || 0) > 0 },
          { label: "Signals Today", value: systemStatus?.signals_today, sub: `${systemStatus?.trades_today || 0} executed`, highlight: true },
        ].map((stat, i) => (
          <Card key={i} className="bg-card/50 backdrop-blur border-border/50 hover:border-primary/30 transition-colors">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
              <h4 className={cn("text-2xl font-bold font-mono-num mt-2", stat.highlight ? "text-foreground" : "text-destructive")}>
                {stat.value}
              </h4>
              <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline Status */}
      <h2 className="text-xl font-bold mt-8 mb-4">6-Layer Pipeline Engine</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {systemStatus?.layers.map((layer) => (
          <div key={layer.name} className="relative group">
            <div className={cn(
              "absolute inset-0 bg-gradient-to-b rounded-xl opacity-0 group-hover:opacity-100 transition-opacity blur-sm",
              layer.status === 'active' ? "from-success/20 to-transparent" : 
              layer.status === 'warning' ? "from-warning/20 to-transparent" : "from-destructive/20 to-transparent"
            )} />
            <Card className="relative bg-card h-full border-border/50 hover:border-border transition-colors">
              <CardContent className="p-4 flex flex-col items-center text-center space-y-3">
                <div className={cn(
                  "p-3 rounded-full border",
                  getStatusColor(layer.status)
                )}>
                  {layer.status === 'active' ? <CheckCircle2 className="w-5 h-5" /> : 
                   layer.status === 'warning' ? <AlertTriangle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="font-semibold text-sm leading-tight">{layer.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{layer.message}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Recent Signals Feed */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Live Signals Feed</h2>
          <Link href="/signals" className="text-sm text-primary hover:underline flex items-center gap-1">
            View All <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        
        <Card className="border-border/50">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 border-b border-border/50">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Instrument</th>
                  <th className="px-4 py-3 font-medium">Setup</th>
                  <th className="px-4 py-3 font-medium">Quality</th>
                  <th className="px-4 py-3 font-medium">Entry</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {signals?.signals.map((sig) => (
                  <tr key={sig.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(sig.created_at), 'HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3 font-bold">{sig.instrument}</td>
                    <td className="px-4 py-3">{sig.setup_type.replace('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num">{formatNumber(sig.final_quality, 1)}%</span>
                        <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary" 
                            style={{ width: `${sig.final_quality}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono-num">{sig.entry_price || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs border uppercase tracking-wider", getStatusColor(sig.status))}>
                        {sig.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!signals?.signals || signals.signals.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No signals recorded yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
