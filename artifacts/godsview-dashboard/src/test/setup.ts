/**
 * Vitest setup — runs once per test file before the suite.
 *
 * - Extends `expect` with `@testing-library/jest-dom` matchers.
 * - Registers MSW as the global fetch mock for the test process.
 * - Shims jsdom gaps that the dashboard reaches for (EventSource,
 *   matchMedia, ResizeObserver, IntersectionObserver).
 *
 * See artifacts/godsview-dashboard/src/test/msw-server.ts for the
 * handler registry; tests can use `server.use(...)` to override a
 * specific handler for a single test.
 */
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw-server";

// ── MSW lifecycle ────────────────────────────────────────────────────────
beforeAll(() => {
  // `onUnhandledRequest: "error"` would turn any un-mocked API call into a
  // test failure. We use "warn" so that smoke tests stay green even if a
  // page fetches a few endpoints beyond the ones we've explicitly mocked;
  // the render itself is what we're validating.
  server.listen({ onUnhandledRequest: "warn" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// ── jsdom shims ──────────────────────────────────────────────────────────

// EventSource is consumed by useEventSource / useAlertStream. jsdom doesn't
// provide it, and the smoke tests don't need a real SSE connection — we
// stub it to a no-op that opens and then stays silent. This is enough for
// the pages to render without throwing.
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    // Defer the "open" callback so components see CONNECTING during mount.
    queueMicrotask(() => {
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.(new Event("open"));
    });
  }
  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (ev: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}
// @ts-expect-error attach to jsdom window
globalThis.EventSource = FakeEventSource;

// matchMedia is read by Tailwind media queries in next-themes and embla.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// ResizeObserver is used by Radix dropdowns + tooltips.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// IntersectionObserver is used by some chart components.
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// scrollTo noop for jsdom.
if (!window.scrollTo) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}

// WebSocket is used by pages that subscribe to live price / news feeds
// (e.g. news-monitor, watchlist). jsdom doesn't ship a WebSocket
// implementation; we stub a minimal class that fires `onopen` in a
// microtask and is otherwise silent. The shim matches the same interface
// as FakeEventSource so pages that guard `new WebSocket()` with try/catch
// keep working too.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  url: string;
  protocol = "";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<(ev: Event) => void>>();
  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }
  addEventListener(type: string, listener: (ev: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (ev: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(_data: string) {
    /* no-op */
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}
// @ts-expect-error attach to jsdom window
globalThis.WebSocket = FakeWebSocket;
