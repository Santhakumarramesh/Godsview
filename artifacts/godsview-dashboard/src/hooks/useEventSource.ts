/**
 * useEventSource — React hook for SSE connections
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Last-Event-ID tracking for replay
 * - Type-safe event handling
 * - Connection status tracking
 * - Automatic cleanup on unmount
 */

import { useEffect, useRef, useState, useCallback } from "react";

export type SSEStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UseEventSourceOptions {
  /** SSE endpoint URL */
  url: string;
  /** Event types to listen for (default: ["message"]) */
  events?: string[];
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: 10) */
  maxRetries?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Whether to connect immediately (default: true) */
  enabled?: boolean;
}

export interface UseEventSourceReturn<T = unknown> {
  /** Latest event data */
  data: T | null;
  /** All events received (last N) */
  events: T[];
  /** Connection status */
  status: SSEStatus;
  /** Last error */
  error: string | null;
  /** Number of events received */
  eventCount: number;
  /** Manually reconnect */
  reconnect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
}

interface MCPStreamEvent {
  subtype: string;
  signalId: string;
  symbol: string;
  [key: string]: unknown;
}

interface BrainGraphEvent {
  signalId: string;
  nodes: Record<string, { active: boolean; score: number | null; data?: unknown }>;
  flow: { currentStep: string; progress: number; latencyMs: number };
  decision: { action: string; grade: string; score: number } | null;
}

const MAX_EVENT_BUFFER = 100;
const MAX_BACKOFF_DELAY = 30000; // 30 seconds

/**
 * Main hook for Server-Sent Events (SSE) connections
 * Handles reconnection, event parsing, and connection status tracking
 */
export function useEventSource<T = unknown>(
  options: UseEventSourceOptions
): UseEventSourceReturn<T> {
  const {
    url,
    events = ["message"],
    autoReconnect = true,
    maxRetries = 10,
    reconnectDelay = 1000,
    enabled = true,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [eventsList, setEventsList] = useState<T[]>([]);
  const [status, setStatus] = useState<SSEStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isCleaningUpRef = useRef(false);

  /**
   * Build SSE URL with Last-Event-ID for replay capability
   */
  const buildUrl = useCallback(() => {
    const baseUrl = new URL(url, typeof window !== "undefined" ? window.location.origin : "");
    if (lastEventIdRef.current) {
      baseUrl.searchParams.set("lastEventId", lastEventIdRef.current);
    }
    return baseUrl.toString();
  }, [url]);

  /**
   * Calculate exponential backoff with jitter
   */
  const getBackoffDelay = useCallback((attempt: number) => {
    const exponential = reconnectDelay * Math.pow(2, attempt);
    const capped = Math.min(exponential, MAX_BACKOFF_DELAY);
    const jitter = capped * 0.1 * Math.random();
    return capped + jitter;
  }, [reconnectDelay]);

  /**
   * Handle incoming SSE event
   */
  const handleEvent = useCallback(
    (eventType: string, event: MessageEvent) => {
      if (event.data === ": ping") return;

      try {
        const parsed = JSON.parse(event.data) as T;

        // Update Last-Event-ID if present
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }

        // Update latest data
        setData(parsed);

        // Add to events buffer (keep last 100)
        setEventsList((prev) => {
          const updated = [...prev, parsed];
          return updated.slice(-MAX_EVENT_BUFFER);
        });

        // Increment event count
        setEventCount((prev) => prev + 1);

        // Reset error and retry count on successful event
        setError(null);
        retryCountRef.current = 0;
      } catch (err) {
        // Ignore malformed JSON frames
        console.debug(`Failed to parse ${eventType} event:`, err);
      }
    },
    []
  );

  /**
   * Attempt to reconnect with exponential backoff
   */
  const attemptReconnect = useCallback(() => {
    if (!autoReconnect || retryCountRef.current >= maxRetries) {
      setStatus("error");
      setError(
        `Failed to reconnect after ${retryCountRef.current} attempts. Max retries (${maxRetries}) reached.`
      );
      return;
    }

    const delay = getBackoffDelay(retryCountRef.current);
    retryCountRef.current += 1;

    reconnectTimeoutRef.current = window.setTimeout(() => {
      if (!isCleaningUpRef.current) {
        connect();
      }
    }, delay);
  }, [autoReconnect, maxRetries, getBackoffDelay]);

  /**
   * Connect to SSE endpoint
   */
  const connect = useCallback(() => {
    if (isCleaningUpRef.current) return;

    try {
      const sseUrl = buildUrl();
      const eventSource = new EventSource(sseUrl);
      esRef.current = eventSource;
      setStatus("connecting");
      setError(null);

      // Handle connection open
      eventSource.onopen = () => {
        setStatus("connected");
        setError(null);
      };

      // Handle errors
      eventSource.onerror = () => {
        if (eventSource.readyState === EventSource.CONNECTING) {
          setStatus("connecting");
        } else {
          setStatus("error");
          setError("Connection error. Attempting to reconnect...");
          eventSource.close();
          esRef.current = null;
          attemptReconnect();
        }
      };

      // Listen to specified event types
      events.forEach((eventType) => {
        eventSource.addEventListener(eventType, (event: Event) => {
          handleEvent(eventType, event as MessageEvent);
        });
      });

      // Also listen to generic message events
      eventSource.onmessage = (event: MessageEvent) => {
        handleEvent("message", event);
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect to SSE endpoint");
      attemptReconnect();
    }
  }, [buildUrl, events, handleEvent, attemptReconnect]);

  /**
   * Manually disconnect
   */
  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  /**
   * Manually reconnect
   */
  const reconnect = useCallback(() => {
    disconnect();
    retryCountRef.current = 0;
    lastEventIdRef.current = null;
    connect();
  }, [disconnect, connect]);

  /**
   * Setup effect: connect on mount, cleanup on unmount
   */
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    isCleaningUpRef.current = false;
    connect();

    return () => {
      isCleaningUpRef.current = true;
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    data,
    events: eventsList,
    status,
    error,
    eventCount,
    reconnect,
    disconnect,
  };
}

/**
 * Specialized hook for MCP stream events
 * Connects to the MCP stream endpoint with "signal" event type
 */
export function useMCPStream(enabled: boolean = true): UseEventSourceReturn<MCPStreamEvent> {
  const apiBase = import.meta.env.VITE_API_URL || "/api";

  return useEventSource<MCPStreamEvent>({
    url: `${apiBase}/mcp/stream`,
    events: ["signal"],
    enabled,
  });
}

/**
 * Specialized hook for brain graph stream events
 * Connects to the brain graph stream endpoint with "signal" event type
 */
export function useBrainGraphStream(
  enabled: boolean = true
): UseEventSourceReturn<BrainGraphEvent> {
  const apiBase = import.meta.env.VITE_API_URL || "/api";

  return useEventSource<BrainGraphEvent>({
    url: `${apiBase}/mcp/stream/brain-graph`,
    events: ["signal"],
    enabled,
  });
}