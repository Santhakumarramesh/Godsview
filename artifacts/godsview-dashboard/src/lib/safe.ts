/**
 * safe.ts — defensive helpers for React pages that consume API responses.
 *
 * Backend endpoints sometimes return:
 *   - bare arrays:        [{...}, {...}]
 *   - wrapped arrays:     { items: [...], total: N }
 *   - empty objects:      {}
 *   - null / undefined:   while the request is in flight or on 503
 *
 * Pages historically assumed bare-array responses and crashed with
 *   `TypeError: x.map is not a function`
 * or
 *   `Cannot read properties of undefined (reading 'foo')`
 * when reality didn't match. These helpers normalise everything so
 * page render code can stay readable without inline guards.
 */

/**
 * Coerce anything into an array. Accepts bare arrays, wrapper objects
 * with a known list-shaped key (positions / items / data / results / etc.),
 * or returns [] for null/undefined/objects with no matching key.
 *
 * Example:
 *   toArray(data)                        // bare array
 *   toArray(data, "positions")           // {positions: [...]}
 *   toArray(data, "items", "results")    // first matching key wins
 */
export function toArray<T = unknown>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
    // Common conventional wrappers, checked after explicit keys.
    for (const k of ["data", "items", "results", "list", "rows", "records", "values"]) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
}

/**
 * Coerce anything into a plain object. Returns {} for null / undefined /
 * arrays / primitives. Useful before destructuring an unknown response.
 *
 *   const { foo, bar } = safeObj(data);
 */
export function safeObj<T extends Record<string, unknown> = Record<string, unknown>>(
  data: unknown,
): T {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as T;
  return {} as T;
}

/**
 * Coerce anything into a finite number. Falls back to `fallback` (default 0)
 * for null / undefined / NaN / non-numeric strings. Useful before calling
 * `.toFixed()` / `.toLocaleString()` etc on potentially-missing fields.
 */
export function safeNum(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Coerce anything into a string. Falls back to `fallback` (default "")
 * for null / undefined.
 */
export function safeStr(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Format a number with `.toFixed(d)` defensively — accepts undefined and
 * returns a placeholder rather than throwing.
 */
export function safeFixed(value: unknown, digits = 2, fallback = "—"): string {
  const n = safeNum(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(digits);
}

/**
 * Format a number with `.toLocaleString()` defensively.
 */
export function safeLocale(value: unknown, fallback = "—"): string {
  const n = safeNum(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return n.toLocaleString();
}

/**
 * Length-safe accessor for arrays / strings.
 */
export function safeLen(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return value.length;
  if (value && typeof value === "object" && "length" in (value as Record<string, unknown>)) {
    const l = (value as { length?: unknown }).length;
    return typeof l === "number" ? l : 0;
  }
  return 0;
}
