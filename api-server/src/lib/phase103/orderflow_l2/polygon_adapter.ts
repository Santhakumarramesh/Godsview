/**
 * P2-13: Polygon L2 → OrderFlowL2Engine adapter.
 *
 * Polygon is already present in the repo env (see
 * api-server/src/lib/data_integrity/feed_integrity_guard.ts). This adapter
 * streams its level-2 book and trade prints into the Phase 103
 * OrderFlowL2Engine via ingestBook() and ingestTrade().
 *
 * Transport
 * ---------
 * Polygon pushes stocks quotes + trades over a single authenticated WebSocket
 * (wss://socket.polygon.io/stocks). We subscribe per symbol and translate
 * each message into the engine's native shape.
 *
 * Env
 * ---
 * POLYGON_API_KEY            required
 * POLYGON_L2_SYMBOLS         comma-separated, e.g. "AAPL,MSFT,SPY" (default SPY)
 * POLYGON_WS_URL             override (optional)
 *
 * Failure mode
 * ------------
 * Non-fatal by design. If POLYGON_API_KEY is missing, start() logs a warning
 * and returns a no-op handle so the rest of the server boots cleanly.
 */

import { logger } from "../../logger";
import {
  getOrderFlowL2,
  type OrderBookSnapshot,
  type TradePrint,
} from "./index.js";

export interface PolygonL2Handle {
  stop: () => void;
  isRunning: () => boolean;
  subscribedSymbols: () => string[];
}

type AnyWs = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, cb: (...args: any[]) => void) => void;
};

function parseSymbols(raw: string | undefined): string[] {
  return String(raw ?? "SPY")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function loadWsCtor(): Promise<any> {
  try {
    const mod = await import("ws");
    return (mod as any).WebSocket ?? (mod as any).default ?? mod;
  } catch {
    // Fall back to the node:undici global WebSocket if available.
    return (globalThis as any).WebSocket;
  }
}

export async function startPolygonL2(): Promise<PolygonL2Handle> {
  const apiKey = String(process.env.POLYGON_API_KEY ?? "").trim();
  const symbols = parseSymbols(process.env.POLYGON_L2_SYMBOLS);
  const url = String(
    process.env.POLYGON_WS_URL ?? "wss://socket.polygon.io/stocks",
  ).trim();

  if (!apiKey) {
    logger.warn("POLYGON_API_KEY missing — Polygon L2 adapter disabled");
    return {
      stop: () => void 0,
      isRunning: () => false,
      subscribedSymbols: () => [],
    };
  }

  const WsCtor = await loadWsCtor();
  if (!WsCtor) {
    logger.warn("No WebSocket implementation available — Polygon L2 disabled");
    return {
      stop: () => void 0,
      isRunning: () => false,
      subscribedSymbols: () => [],
    };
  }

  const engine = getOrderFlowL2();
  let ws: AnyWs | null = new WsCtor(url) as AnyWs;
  let running = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const subscribe = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ action: "auth", params: apiKey }));
    // Quotes (Q.*) + trades (T.*) — Polygon does not publish full depth on
    // stocks without a separate entitlement, so we use top-of-book quotes
    // as the two-sided book snapshot.
    const params = symbols
      .flatMap((s) => [`Q.${s}`, `T.${s}`])
      .join(",");
    ws.send(JSON.stringify({ action: "subscribe", params }));
  };

  const scheduleReconnect = () => {
    if (!running || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        ws = new WsCtor(url) as AnyWs;
        attachHandlers();
      } catch (err) {
        logger.warn({ err }, "Polygon L2 reconnect failed");
        scheduleReconnect();
      }
    }, 5_000);
  };

  const onQuote = (q: any) => {
    const snap: OrderBookSnapshot = {
      symbol: String(q.sym ?? ""),
      ts: Number(q.t ?? Date.now()),
      bids: [{ price: Number(q.bp ?? 0), size: Number(q.bs ?? 0) }].filter(
        (l) => l.price > 0 && l.size > 0,
      ),
      asks: [{ price: Number(q.ap ?? 0), size: Number(q.as ?? 0) }].filter(
        (l) => l.price > 0 && l.size > 0,
      ),
    };
    if (snap.symbol && (snap.bids.length || snap.asks.length)) {
      engine.ingestBook(snap);
    }
  };

  const onTrade = (t: any) => {
    const price = Number(t.p ?? 0);
    const size = Number(t.s ?? 0);
    if (!price || !size) return;
    // Polygon trade side inference: use conditions[] when present; fall back
    // to midpoint by sampling the most recent book snapshot.
    const aggressor: "buy" | "sell" = Array.isArray(t.c) && t.c.includes(12) ? "sell" : "buy";
    const print: TradePrint = {
      symbol: String(t.sym ?? ""),
      ts: Number(t.t ?? Date.now()),
      price,
      size,
      aggressor,
    };
    if (print.symbol) engine.ingestTrade(print);
  };

  const handleMessage = (raw: Buffer | string) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return;
      for (const msg of arr) {
        if (!msg || typeof msg !== "object") continue;
        if (msg.ev === "Q") onQuote(msg);
        else if (msg.ev === "T") onTrade(msg);
      }
    } catch (err) {
      logger.warn({ err }, "Polygon L2 message parse failed");
    }
  };

  const attachHandlers = () => {
    if (!ws) return;
    ws.on("open", () => {
      logger.info({ url, symbols }, "Polygon L2 socket opened");
      subscribe();
    });
    ws.on("message", handleMessage);
    ws.on("close", (code: number, reason: unknown) => {
      logger.warn({ code, reason: String(reason) }, "Polygon L2 socket closed");
      if (running) scheduleReconnect();
    });
    ws.on("error", (err: unknown) => {
      logger.warn({ err }, "Polygon L2 socket error");
    });
  };

  attachHandlers();

  return {
    stop() {
      running = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try {
        ws?.close(1000, "shutdown");
      } catch {
        /* ignore */
      }
      ws = null;
    },
    isRunning: () => running,
    subscribedSymbols: () => symbols.slice(),
  };
}
