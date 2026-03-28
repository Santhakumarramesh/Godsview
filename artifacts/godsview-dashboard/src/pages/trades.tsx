import { useGetTrades, useCreateTrade, useUpdateTrade, type CreateTradeRequest, type UpdateTradeRequest } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent, getStatusColor, cn } from "@/lib/utils";
import { RefreshCcw, Plus, XCircle } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function Trades() {
  const { data, isLoading } = useGetTrades({ limit: 50 });
  const [showCreate, setShowCreate] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trade Journal</h1>
          <p className="text-muted-foreground mt-1">Execution history and P&L tracking.</p>
        </div>
        <button 
          onClick={() => setShowCreate(true)}
          className="bg-secondary border border-border hover:bg-secondary/80 text-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Record Trade
        </button>
      </div>

      {showCreate && <CreateTradeDialog onClose={() => setShowCreate(false)} />}
      {editingTradeId !== null && <UpdateTradeDialog tradeId={editingTradeId} onClose={() => setEditingTradeId(null)} />}

      <Card className="border-border/50">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-12 flex justify-center"><RefreshCcw className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 border-b border-border/50 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Dir</th>
                  <th className="px-4 py-3 font-medium">Setup</th>
                  <th className="px-4 py-3 font-medium text-right">Entry</th>
                  <th className="px-4 py-3 font-medium text-right">Exit</th>
                  <th className="px-4 py-3 font-medium text-right">P&L</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data?.trades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(trade.created_at), 'MM/dd HH:mm')}
                    </td>
                    <td className="px-4 py-3 font-bold text-foreground">{trade.instrument}</td>
                    <td className="px-4 py-3">
                      <span className={cn("font-bold", trade.direction === 'long' ? "text-success" : "text-destructive")}>
                        {trade.direction.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{trade.setup_type}</td>
                    <td className="px-4 py-3 font-mono-num text-right">{trade.entry_price}</td>
                    <td className="px-4 py-3 font-mono-num text-right">{trade.exit_price || '-'}</td>
                    <td className="px-4 py-3 font-mono-num text-right">
                      <span className={cn("font-semibold", (trade.pnl || 0) > 0 ? "text-success" : (trade.pnl || 0) < 0 ? "text-destructive" : "")}>
                        {formatCurrency(trade.pnl)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider", getStatusColor(trade.outcome))}>
                        {trade.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button 
                        onClick={() => setEditingTradeId(trade.id)}
                        className="text-xs text-primary hover:text-primary-foreground hover:underline transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Update
                      </button>
                    </td>
                  </tr>
                ))}
                {(!data?.trades || data.trades.length === 0) && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No trades recorded yet.
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

function CreateTradeDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useCreateTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
        onClose();
      }
    }
  });

  const [formData, setFormData] = useState<Partial<CreateTradeRequest>>({
    instrument: "MES",
    setup_type: "absorption_reversal",
    direction: "long",
    entry_price: 0,
    stop_loss: 0,
    take_profit: 0,
    quantity: 1,
    session: "NY"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: formData as CreateTradeRequest });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-border/50 flex justify-between items-center">
          <h2 className="text-xl font-bold">Record Trade</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><XCircle className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Instrument</label>
              <input type="text" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none" value={formData.instrument} onChange={e => setFormData({...formData, instrument: e.target.value})} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Direction</label>
              <select className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none" value={formData.direction} onChange={e => setFormData({...formData, direction: e.target.value as 'long'|'short'})} required>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>
            {['entry_price', 'stop_loss', 'take_profit', 'quantity'].map((field) => (
              <div key={field} className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium capitalize">{field.replace('_', ' ')}</label>
                <input type="number" step="0.01" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono-num" value={formData[field as keyof typeof formData] as number} onChange={e => setFormData({...formData, [field]: Number(e.target.value)})} required />
              </div>
            ))}
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {mutation.isPending ? "Saving..." : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UpdateTradeDialog({ tradeId, onClose }: { tradeId: number, onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useUpdateTrade({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
        onClose();
      }
    }
  });

  const [formData, setFormData] = useState<Partial<UpdateTradeRequest>>({
    outcome: "win",
    exit_price: 0,
    pnl: 0,
    notes: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ id: tradeId, data: formData as UpdateTradeRequest });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
        <div className="p-6 border-b border-border/50 flex justify-between items-center">
          <h2 className="text-xl font-bold">Update Outcome</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><XCircle className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Outcome</label>
            <select className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none" value={formData.outcome} onChange={e => setFormData({...formData, outcome: e.target.value as any})} required>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="breakeven">Breakeven</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Exit Price</label>
              <input type="number" step="0.01" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono-num" value={formData.exit_price} onChange={e => setFormData({...formData, exit_price: Number(e.target.value)})} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">P&L ($)</label>
              <input type="number" step="0.01" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono-num" value={formData.pnl} onChange={e => setFormData({...formData, pnl: Number(e.target.value)})} />
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {mutation.isPending ? "Updating..." : "Update"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
