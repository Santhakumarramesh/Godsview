import { useGetSignals, useCreateSignal, type CreateSignalRequest } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { formatNumber, getStatusColor, cn } from "@/lib/utils";
import { RefreshCcw, Filter, Plus } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function Signals() {
  const [instrumentFilter, setInstrumentFilter] = useState<string>("");
  const { data, isLoading } = useGetSignals({ instrument: instrumentFilter || undefined, limit: 50 });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Signals Database</h1>
          <p className="text-muted-foreground mt-1">Raw output from the 6-layer reasoning pipeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <select 
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
          >
            <option value="">All Instruments</option>
            <option value="MES">MES</option>
            <option value="MNQ">MNQ</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
          </select>
          <button 
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-[0_0_15px_-3px_rgba(59,130,246,0.4)] hover:shadow-[0_0_20px_-3px_rgba(59,130,246,0.6)]"
          >
            <Plus className="w-4 h-4" /> Inject Signal
          </button>
        </div>
      </div>

      {showCreate && <CreateSignalDialog onClose={() => setShowCreate(false)} />}

      <Card className="border-border/50">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-12 flex justify-center"><RefreshCcw className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 border-b border-border/50 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Setup</th>
                  <th className="px-4 py-3 font-medium">Str</th>
                  <th className="px-4 py-3 font-medium">OF</th>
                  <th className="px-4 py-3 font-medium">Rcl</th>
                  <th className="px-4 py-3 font-medium">ML</th>
                  <th className="px-4 py-3 font-medium">Cld</th>
                  <th className="px-4 py-3 font-medium">Final Q.</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data?.signals.map((sig) => (
                  <tr key={sig.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(sig.created_at), 'MM/dd HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3 font-bold text-foreground">{sig.instrument}</td>
                    <td className="px-4 py-3">{sig.setup_type}</td>
                    <td className="px-4 py-3 font-mono-num text-xs">{formatNumber(sig.structure_score, 1)}</td>
                    <td className="px-4 py-3 font-mono-num text-xs">{formatNumber(sig.order_flow_score, 1)}</td>
                    <td className="px-4 py-3 font-mono-num text-xs">{formatNumber(sig.recall_score, 1)}</td>
                    <td className="px-4 py-3 font-mono-num text-xs">{formatNumber(sig.ml_probability, 1)}</td>
                    <td className="px-4 py-3 font-mono-num text-xs">{formatNumber(sig.claude_score, 1)}</td>
                    <td className="px-4 py-3">
                       <span className={cn(
                         "font-mono-num font-bold", 
                         sig.final_quality > 80 ? "text-success" : sig.final_quality > 50 ? "text-warning" : "text-destructive"
                       )}>
                         {formatNumber(sig.final_quality, 1)}%
                       </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider", getStatusColor(sig.status))}>
                        {sig.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!data?.signals || data.signals.length === 0) && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                      No signals found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

function CreateSignalDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useCreateSignal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
        onClose();
      }
    }
  });

  const [formData, setFormData] = useState<Partial<CreateSignalRequest>>({
    instrument: "MES",
    setup_type: "sweep_reclaim",
    structure_score: 85,
    order_flow_score: 70,
    recall_score: 90,
    ml_probability: 75,
    claude_score: 88,
    news_lockout: false
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: formData as CreateSignalRequest });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-border/50 flex justify-between items-center">
          <h2 className="text-xl font-bold">Inject Manual Signal</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
             <XCircle className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Instrument</label>
              <input 
                type="text" 
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
                value={formData.instrument}
                onChange={e => setFormData({...formData, instrument: e.target.value})}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Setup Type</label>
              <input 
                type="text" 
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none"
                value={formData.setup_type}
                onChange={e => setFormData({...formData, setup_type: e.target.value})}
                required
              />
            </div>
            {['structure_score', 'order_flow_score', 'recall_score', 'ml_probability', 'claude_score'].map((field) => (
              <div key={field} className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium capitalize">{field.replace('_', ' ')}</label>
                <input 
                  type="number" 
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono-num"
                  value={formData[field as keyof typeof formData] as number}
                  onChange={e => setFormData({...formData, [field]: Number(e.target.value)})}
                  required
                />
              </div>
            ))}
            <div className="space-y-1 flex items-center gap-2 pt-6">
              <input 
                type="checkbox" 
                id="news_lockout"
                checked={formData.news_lockout}
                onChange={e => setFormData({...formData, news_lockout: e.target.checked})}
                className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary focus:ring-offset-background"
              />
              <label htmlFor="news_lockout" className="text-sm font-medium">News Lockout Override</label>
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button 
              type="submit" 
              disabled={mutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {mutation.isPending ? "Injecting..." : "Process Signal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
