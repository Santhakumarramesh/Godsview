/**
 * Phase 26 — Terminal Adapter
 *
 * Multi-panel terminal layout, command palette, and watchlist management.
 */

export interface TerminalPanel {
  name: string;
  title: string;
  position: "left" | "center" | "right" | "top" | "bottom";
  width?: number;
  height?: number;
  refreshIntervalMs?: number;
}

export interface TerminalLayout {
  id: string;
  name: string;
  panels: TerminalPanel[];
  theme?: "light" | "dark";
  createdAt: string;
  updatedAt: string;
}

export interface Command {
  id: string;
  name: string;
  description: string;
  category: string;
  handlerKey: string;
  aliases?: string[];
}

export interface OverlaySignal {
  id: string;
  symbol: string;
  direction: "long" | "short" | "neutral";
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: string;
  source: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// TerminalLayout Factory
// ──────────────────────────────────────────────────────────────────────────────

export function getTerminalLayout(): TerminalLayout {
  return {
    id: "layout_default_001",
    name: "Default Trading Terminal",
    panels: [
      {
        name: "watchlist",
        title: "Watchlist",
        position: "left",
        width: 25,
        refreshIntervalMs: 1000,
      },
      {
        name: "macro_news",
        title: "Macro News & Alerts",
        position: "top",
        height: 15,
        refreshIntervalMs: 5000,
      },
      {
        name: "portfolio",
        title: "Portfolio Overview",
        position: "right",
        width: 25,
        refreshIntervalMs: 2000,
      },
      {
        name: "brain",
        title: "Brain Decision Panel",
        position: "center",
        refreshIntervalMs: 1000,
      },
      {
        name: "execution",
        title: "Execution Console",
        position: "bottom",
        height: 20,
        refreshIntervalMs: 500,
      },
      {
        name: "alerts",
        title: "Alerts & Notifications",
        position: "right",
        height: 10,
        refreshIntervalMs: 1000,
      },
    ],
    theme: "dark",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CommandPalette — In-memory registry with fuzzy search
// ──────────────────────────────────────────────────────────────────────────────

export class CommandPalette {
  private commands: Map<string, Command> = new Map();
  private commandsByName: Map<string, string> = new Map(); // name -> id

  constructor() {
    this._registerBloombergCommands();
  }

  /**
   * Register a command in the palette
   */
  registerCommand(
    name: string,
    description: string,
    category: string,
    handlerKey: string,
    aliases?: string[]
  ): void {
    const id = `cmd_${Math.random().toString(36).slice(2, 9)}`;
    const command: Command = {
      id,
      name,
      description,
      category,
      handlerKey,
      aliases,
    };

    this.commands.set(id, command);
    this.commandsByName.set(name, id);

    if (aliases) {
      for (const alias of aliases) {
        this.commandsByName.set(alias, id);
      }
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Fuzzy search commands by name or description
   */
  searchCommands(query: string): Command[] {
    const lowerQuery = query.toLowerCase();
    return this.getCommands().filter((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(lowerQuery);
      const descMatch = cmd.description.toLowerCase().includes(lowerQuery);
      const aliasMatch = cmd.aliases?.some((a) =>
        a.toLowerCase().includes(lowerQuery)
      );
      return nameMatch || descMatch || aliasMatch;
    });
  }

  /**
   * Get a command by ID
   */
  getCommand(id: string): Command | undefined {
    return this.commands.get(id);
  }

  /**
   * Get a command by name (including aliases)
   */
  getCommandByName(name: string): Command | undefined {
    const id = this.commandsByName.get(name.toLowerCase());
    return id ? this.commands.get(id) : undefined;
  }

  /**
   * Register Bloomberg-style commands
   */
  private _registerBloombergCommands(): void {
    // Kill switch
    this.registerCommand(
      "kill",
      "Activate emergency kill switch to halt all trading",
      "control",
      "kill_switch"
    );

    // Position management
    this.registerCommand(
      "flatten",
      "Close all open positions immediately",
      "positions",
      "flatten_positions",
      ["close-all", "exit-all"]
    );

    // Pause/Resume
    this.registerCommand(
      "pause",
      "Pause autonomous trading operations",
      "control",
      "pause_trading"
    );

    this.registerCommand(
      "resume",
      "Resume autonomous trading operations",
      "control",
      "resume_trading"
    );

    // Status queries
    this.registerCommand(
      "status",
      "Get current system status and health metrics",
      "info",
      "system_status",
      ["health", "check"]
    );

    // Risk monitoring
    this.registerCommand(
      "risk",
      "Display current risk exposure and metrics",
      "risk",
      "risk_status"
    );

    this.registerCommand(
      "exposure",
      "Show portfolio exposure by sector and instrument",
      "risk",
      "exposure_report"
    );

    // Portfolio
    this.registerCommand(
      "positions",
      "List all active positions with P&L",
      "portfolio",
      "list_positions",
      ["pos"]
    );

    // Monitoring
    this.registerCommand(
      "watchlist",
      "Display or manage watchlist symbols",
      "monitoring",
      "watchlist_manager",
      ["watch"]
    );

    this.registerCommand(
      "alerts",
      "Show active alerts and notification rules",
      "monitoring",
      "alerts_list",
      ["notify"]
    );

    // Intelligence
    this.registerCommand(
      "brain",
      "Access brain decision system and reasoning",
      "intelligence",
      "brain_reasoning"
    );

    this.registerCommand(
      "autonomous",
      "View autonomous candidate status and approval queue",
      "intelligence",
      "autonomous_queue",
      ["candidates", "approval"]
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// WatchlistManager — In-memory symbol tracking
// ──────────────────────────────────────────────────────────────────────────────

export class WatchlistManager {
  private symbols: Set<string> = new Set();

  /**
   * Add a symbol to the watchlist
   */
  addToWatchlist(symbol: string): boolean {
    const normalized = symbol.toUpperCase();
    if (this.symbols.has(normalized)) {
      return false; // already exists
    }
    this.symbols.add(normalized);
    return true;
  }

  /**
   * Remove a symbol from the watchlist
   */
  removeFromWatchlist(symbol: string): boolean {
    return this.symbols.delete(symbol.toUpperCase());
  }

  /**
   * Get current watchlist
   */
  getWatchlist(): string[] {
    return Array.from(this.symbols);
  }

  /**
   * Check if symbol is in watchlist
   */
  hasSymbol(symbol: string): boolean {
    return this.symbols.has(symbol.toUpperCase());
  }

  /**
   * Clear all symbols (testing utility)
   */
  _clearAll(): void {
    this.symbols.clear();
  }
}
