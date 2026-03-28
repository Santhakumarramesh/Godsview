import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart2, 
  Briefcase, 
  Cpu, 
  LayoutDashboard, 
  Menu,
  TerminalSquare
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/signals", label: "Signals Feed", icon: Activity },
  { href: "/trades", label: "Trade Journal", icon: Briefcase },
  { href: "/performance", label: "Analytics", icon: BarChart2 },
  { href: "/system", label: "System Core", icon: Cpu },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row dark">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-6 h-6 text-primary" />
          <span className="font-bold tracking-wider">GODSVIEW</span>
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "w-64 border-r border-border bg-card flex-col transition-all duration-300 z-50",
        "fixed md:relative h-[calc(100vh-65px)] md:h-screen",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 hidden md:flex items-center gap-3 border-b border-border/50">
          <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/30">
            <TerminalSquare className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-lg tracking-widest text-foreground">GODSVIEW</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">Pipeline Control</div>
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer group",
                  isActive 
                    ? "bg-primary/15 text-primary border border-primary/20 shadow-[0_0_15px_-3px_rgba(59,130,246,0.15)]" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                )}>
                  <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "group-hover:text-foreground")} />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-success">System Online</span>
              <span className="text-[10px] text-success/70 font-mono-num">Lat: 12ms | V 0.1.0</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto h-[calc(100vh-65px)] md:h-screen relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)] pointer-events-none" />
        <div className="p-4 md:p-8 relative z-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
