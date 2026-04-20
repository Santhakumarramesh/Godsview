/**
 * @gv/api-client — Phase 7 mobile operator inbox endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/mobile.py:
 *
 *   api.mobileInbox.list           — cursor-paginated inbox feed
 *   api.mobileInbox.summary        — header counts (open / critical / …)
 *   api.mobileInbox.ack            — acknowledge a row
 *
 * The mobile inbox is read-only aside from the acknowledgement hook. Every
 * row carries a `deepLink` back into the desktop app; the mobile client
 * renders the row locally and opens the desktop route when the operator
 * taps through. Push notifications (APNs / FCM) are delivered out-of-band
 * and carry the same deep link as the payload.
 *
 * Pagination is cursor-based: call `list` with `cursor: list.nextCursor`
 * until `nextCursor` comes back null. The server keeps cursors valid for
 * 30 minutes and rejects stale cursors with 410.
 */
import type {
  MobileInboxAckRequest,
  MobileInboxFilter,
  MobileInboxItem,
  MobileInboxList,
  MobileInboxSummary,
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

// ───────────────────────────── inbox ───────────────────────────────────

export interface MobileInboxEndpoints {
  /** GET /mobile/inbox — paginated feed, filterable by kind / severity / status. */
  list: (filter?: MobileInboxFilter) => Promise<MobileInboxList>;
  /** GET /mobile/inbox/:id — single row (for deep-link landing pages). */
  get: (id: string) => Promise<MobileInboxItem>;
  /** GET /mobile/inbox/summary — header counts + throttled flag. */
  summary: () => Promise<MobileInboxSummary>;
  /**
   * POST /mobile/inbox/:id/ack — flip open → acknowledged. The server
   * records the ack in `mobile_inbox_ack_events` for audit.
   */
  ack: (req: MobileInboxAckRequest) => Promise<MobileInboxItem>;
}

export function mobileInboxEndpoints(
  client: ApiClient,
): MobileInboxEndpoints {
  return {
    list: (filter = { limit: 50 } as MobileInboxFilter) =>
      client.get<MobileInboxList>(`/mobile/inbox${qs(filter)}`),
    get: (id) =>
      client.get<MobileInboxItem>(`/mobile/inbox/${encodeURIComponent(id)}`),
    summary: () => client.get<MobileInboxSummary>(`/mobile/inbox/summary`),
    ack: (req) =>
      client.post<MobileInboxItem>(
        `/mobile/inbox/${encodeURIComponent(req.id)}/ack`,
        req.note !== undefined ? { note: req.note } : {},
      ),
  };
}
