/**
 * @gv/api-client — Phase 5 recall + memory endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/recall.py:
 *
 *   api.recall              — similarity search, trade memory listing,
 *                             chart-screenshot memory, missed-trade log.
 *
 * Similarity search is deterministic (no LLM): a 64-dim feature vector
 * packed over (symbol, tf, regime, session, structure flags, order-flow
 * posture, confidence). Results carry an aggregate summary so UIs can
 * render "setups like this won X%" without a second round-trip.
 */
import type {
  MissedTrade,
  MissedTradesListOut,
  RecallScreenshot,
  RecallScreenshotsListOut,
  RecallSearchRequest,
  RecallSearchResult,
  RecallTrade,
  RecallTradeFilter,
  RecallTradesListOut,
  ScreenshotCreateRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── recall ───────────────────────────────────

export interface MissedTradeFilter {
  symbolId?: string;
  fromTs?: string;
  toTs?: string;
  reason?: MissedTrade["reason"];
  cursor?: string;
  limit?: number;
}

export interface RecallEndpoints {
  /** POST /recall/search — similarity search over stored trades. */
  search: (req: RecallSearchRequest) => Promise<RecallSearchResult>;
  /** GET /recall/trades — list stored recall trades. */
  listTrades: (filter?: RecallTradeFilter) => Promise<RecallTradesListOut>;
  /** GET /recall/trades/:id */
  getTrade: (id: string) => Promise<RecallTrade>;
  /** GET /recall/screenshots — list chart screenshots. */
  listScreenshots: (opts?: {
    setupId?: string;
    symbolId?: string;
    cursor?: string;
    limit?: number;
  }) => Promise<RecallScreenshotsListOut>;
  /** GET /recall/screenshots/:id */
  getScreenshot: (id: string) => Promise<RecallScreenshot>;
  /** POST /recall/screenshots — attach a screenshot (admin only). */
  createScreenshot: (
    req: ScreenshotCreateRequest,
  ) => Promise<RecallScreenshot>;
  /** GET /recall/missed — list systematic misses. */
  listMissed: (filter?: MissedTradeFilter) => Promise<MissedTradesListOut>;
}

export function recallEndpoints(client: ApiClient): RecallEndpoints {
  return {
    search: (req) => client.post<RecallSearchResult>(`/recall/search`, req),
    listTrades: (filter = { limit: 50 } as RecallTradeFilter) =>
      client.get<RecallTradesListOut>(`/recall/trades${qs(filter)}`),
    getTrade: (id) =>
      client.get<RecallTrade>(`/recall/trades/${encodeURIComponent(id)}`),
    listScreenshots: (opts = {}) =>
      client.get<RecallScreenshotsListOut>(
        `/recall/screenshots${qs(opts)}`,
      ),
    getScreenshot: (id) =>
      client.get<RecallScreenshot>(
        `/recall/screenshots/${encodeURIComponent(id)}`,
      ),
    createScreenshot: (req) =>
      client.post<RecallScreenshot>(`/recall/screenshots`, req),
    listMissed: (filter = { limit: 50 }) =>
      client.get<MissedTradesListOut>(`/recall/missed${qs(filter)}`),
  };
}
