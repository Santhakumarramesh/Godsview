import { useGetSystemStatus } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn, getStatusColor } from "@/lib/utils";
import { Cpu, Terminal, ShieldAlert, Activity, GitBranch, Brain, Settings2, RefreshCcw } from "lucide-react";
import { format } from "date-fns";

export default function System() {
  const { data, isLoading } = useGetSystemStatus();

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
