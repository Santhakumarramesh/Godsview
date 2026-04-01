/**
 * GodsView WebSocket Manager
 * Handles real-time price feeds, signal updates, and system events.
 * Auto-reconnects with exponential backoff.
 */

type WSMessageType =
  | "ticker"        // Live price updates
  | "signal"        // New signal candidate
  | "decision"      // Pipeline decision (TRADE/PASS/REJECTED/BLOCKED)
  | "risk_event"    // Risk gate changes, rail triggers
  | "brain_update"  // Brain cycle completed
  | "orderbook"     // Order book delta
  | "tape"          // Time & sales print
  | "system"        // System status change
  | "error";        // Error message

interface WSMessage {
  type: WSMessageType;
  payload: any;
  timestamp: number;
}

type WSListener = (msg: WSMessage) => void;

interface WSManagerOptions {
  url?: string;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
}
class GodsviewWSManager {
  private ws: WebSocket | null = null;
  private listeners = new Map<WSMessageType | "*", Set<WSListener>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private reconnectDelay: number;
  private maxReconnectDelay: number;
  private heartbeatInterval: number;
  private _isConnected = false;
  private _isConnecting = false;
  private subscriptions = new Set<string>();

  constructor(options: WSManagerOptions = {}) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.url = options.url || `${protocol}//${window.location.host}/ws`;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.heartbeatInterval = options.heartbeatInterval || 25000;
  }

  get isConnected() { return this._isConnected; }

  connect(): void {
    if (this._isConnecting || this._isConnected) return;
    this._isConnecting = true;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this._isConnected = true;
        this._isConnecting = false;
        this.reconnectAttempts = 0;
        console.log("[GodsView WS] Connected");
        this.startHeartbeat();
        // Re-subscribe to channels
        this.subscriptions.forEach((channel) => {
          this.send({ type: "subscribe", channel });
        });
        this.emit({ type: "system", payload: { event: "connected" }, timestamp: Date.now() });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          this.emit(msg);
        } catch {
          console.warn("[GodsView WS] Failed to parse message:", event.data);
        }
      };

      this.ws.onclose = (event) => {
        this._isConnected = false;
        this._isConnecting = false;
        this.stopHeartbeat();
        console.log(`[GodsView WS] Disconnected (code: ${event.code})`);
        this.emit({ type: "system", payload: { event: "disconnected", code: event.code }, timestamp: Date.now() });
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this._isConnecting = false;
        // onclose will fire after this
      };
    } catch {
      this._isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.reconnectAttempts = -1; // Prevent reconnect
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close(1000, "Client disconnect");
    this.ws = null;
    this._isConnected = false;
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────
  subscribe(channel: string): void {
    this.subscriptions.add(channel);
    if (this._isConnected) {
      this.send({ type: "subscribe", channel });
    }
  }

  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this._isConnected) {
      this.send({ type: "unsubscribe", channel });
    }
  }
  // ─── Listeners ───────────────────────────────────────────────────────────
  on(type: WSMessageType | "*", listener: WSListener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => { this.listeners.get(type)?.delete(listener); };
  }

  off(type: WSMessageType | "*", listener: WSListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  // ─── Send ────────────────────────────────────────────────────────────────
  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────
  private emit(msg: WSMessage): void {
    // Type-specific listeners
    this.listeners.get(msg.type)?.forEach((fn) => fn(msg));
    // Wildcard listeners
    this.listeners.get("*")?.forEach((fn) => fn(msg));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts < 0) return; // Intentional disconnect
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    console.log(`[GodsView WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping", timestamp: Date.now() });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────
export const wsManager = new GodsviewWSManager();

// ─── React Hook ──────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback, useRef } from "react";

export function useWSConnection() {
  const [connected, setConnected] = useState(wsManager.isConnected);

  useEffect(() => {
    wsManager.connect();
    const off = wsManager.on("system", (msg) => {
      if (msg.payload?.event === "connected") setConnected(true);
      if (msg.payload?.event === "disconnected") setConnected(false);
    });
    return off;
  }, []);

  return connected;
}
export function useWSMessage<T = any>(type: WSMessageType): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    return wsManager.on(type, (msg) => setData(msg.payload as T));
  }, [type]);
  return data;
}

export function useWSMessages<T = any>(type: WSMessageType, maxBuffer = 100): T[] {
  const [buffer, setBuffer] = useState<T[]>([]);
  useEffect(() => {
    return wsManager.on(type, (msg) => {
      setBuffer((prev) => [msg.payload as T, ...prev].slice(0, maxBuffer));
    });
  }, [type, maxBuffer]);
  return buffer;
}

export function useWSSubscription(channel: string) {
  useEffect(() => {
    wsManager.subscribe(channel);
    return () => wsManager.unsubscribe(channel);
  }, [channel]);
}

export function useLiveTicker(symbols: string[]) {
  const [tickers, setTickers] = useState<Record<string, { price: number; change: number; change_pct: number }>>({});

  useEffect(() => {
    symbols.forEach((s) => wsManager.subscribe(`ticker:${s}`));
    const off = wsManager.on("ticker", (msg) => {
      const { symbol, price, change, change_pct } = msg.payload;
      setTickers((prev) => ({ ...prev, [symbol]: { price, change, change_pct } }));
    });
    return () => {
      off();
      symbols.forEach((s) => wsManager.unsubscribe(`ticker:${s}`));
    };
  }, [symbols.join(",")]);

  return tickers;
}
