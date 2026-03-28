import { useEffect, useRef, useState } from "react";

export type OrderbookLevel = {
  price: number;
  size: number;
};

export type OrderbookSnapshot = {
  symbol: string;
  timestamp: string;
  receivedAt: number;
  source: "rest" | "ws";
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  bestBid: OrderbookLevel | null;
  bestAsk: OrderbookLevel | null;
  spread: number | null;
  totalBids: number;
  totalAsks: number;
};

export type OrderbookStatus = "connecting" | "live" | "ws" | "error";

const BASE = "/api";

export function useOrderbook(symbol: string, depth: number = 20) {
  const [data, setData]     = useState<OrderbookSnapshot | null>(null);
  const [status, setStatus] = useState<OrderbookStatus>("connecting");
  const esRef               = useRef<EventSource | null>(null);

  useEffect(() => {
    setData(null);
    setStatus("connecting");

    const es = new EventSource(
      `${BASE}/orderbook/stream?symbol=${encodeURIComponent(symbol)}&depth=${depth}`
    );
    esRef.current = es;

    es.onopen = () => setStatus("connecting");

    es.onmessage = (evt) => {
      if (evt.data === ": ping") return;
      try {
        const payload = JSON.parse(evt.data) as OrderbookSnapshot;
        setData(payload);
        setStatus(payload.source === "ws" ? "ws" : "live");
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      setStatus("error");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [symbol, depth]);

  return { data, status };
}
