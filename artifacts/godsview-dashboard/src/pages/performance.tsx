import { useGetPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";
import { RefreshCcw } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";

export default function Performance() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useGetPerformance({ days });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-full"><RefreshCcw className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Performance Analytics</h1>
          <p className="text-muted-foreground mt-1">Deep dive into bot profitability and edge.</p>
        </div>
        <select 
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:border-primary focus:outline-none w-fit"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 Days</option>
          <option value={30}>Last 30 Days</option>
          <option value={90}>Last 90 Days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: "Total P&L", value: formatCurrency(data.total_pnl), positive: data.total_pnl > 0 },
          { label: "Win Rate", value: formatPercent(data.win_rate), positive: data.win_rate > 50 },
          { label: "Profit Factor", value: data.profit_factor.toFixed(2), positive: data.profit_factor > 1 },
          { label: "Total Trades", value: data.total_trades, positive: true },
          { label: "Avg Win", value: formatCurrency(data.avg_win), positive: true },
          { label: "Max Drawdown", value: formatCurrency(data.max_drawdown), positive: false },
        ].map((stat, i) => (
          <Card key={i} className="border-border/50 bg-card">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <h4 className={cn("text-xl font-bold font-mono-num mt-1", stat.positive ? "text-foreground" : "text-destructive")}>
                {stat.value}
              </h4>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/50">
          <CardHeader className="pb-2 border-b-0">
            <CardTitle className="text-base font-semibold">Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.equity_curve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'var(--font-mono)' }}
                  />
                  <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorEquity)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2 border-b-0">
            <CardTitle className="text-base font-semibold">Edge by Setup</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.by_setup} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={true} vertical={false} />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="setup_type" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={80} />
                  <Tooltip cursor={{fill: 'hsl(var(--muted)/0.3)'}} contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
                  <Bar dataKey="expectancy" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Session Performance</CardTitle>
          </CardHeader>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground border-y border-border/50">
                <tr>
                  <th className="py-2 px-4 text-left font-medium">Session</th>
                  <th className="py-2 px-4 text-right font-medium">Win Rate</th>
                  <th className="py-2 px-4 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.by_session.map(s => (
                  <tr key={s.session} className="hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium">{s.session}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{formatPercent(s.win_rate)}</td>
                    <td className={cn("py-3 px-4 text-right font-mono-num font-medium", s.total_pnl >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(s.total_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Regime Performance</CardTitle>
          </CardHeader>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground border-y border-border/50">
                <tr>
                  <th className="py-2 px-4 text-left font-medium">Regime</th>
                  <th className="py-2 px-4 text-right font-medium">Win Rate</th>
                  <th className="py-2 px-4 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.by_regime.map(r => (
                  <tr key={r.regime} className="hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium capitalize">{r.regime.replace('_', ' ')}</td>
                    <td className="py-3 px-4 text-right font-mono-num">{formatPercent(r.win_rate)}</td>
                    <td className={cn("py-3 px-4 text-right font-mono-num font-medium", r.total_pnl >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(r.total_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
