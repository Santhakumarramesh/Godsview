/**
 * Express 5 / @types/express 5 type narrowing helpers.
 *
 * Express types `req.params[key]` and `req.query[key]` as
 * `string | string[] | ParsedQs | undefined` because middleware can swap in
 * array params. For our scalar URL paths we always want the first scalar
 * string. Centralising the coercion keeps the route handlers readable.
 */

/** Coerce an Express param/query value to a non-empty string. */
export function paramString(value: unknown, fallback = ""): string {
  if (Array.isArray(value)) return String(value[0] ?? fallback);
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Coerce + uppercase (handy for ticker symbols). */
export function paramSymbol(value: unknown, fallback = ""): string {
  return paramString(value, fallback).toUpperCase();
}

/** Coerce to integer with a default + range clamp. */
export function paramInt(
  value: unknown,
  defaultValue: number,
  min = -Infinity,
  max = Infinity,
): number {
  const raw = paramString(value, "");
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

/** Coerce to a finite float with a default. */
export function paramFloat(value: unknown, defaultValue: number): number {
  const raw = paramString(value, "");
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Coerce to one of a fixed set of string literals; falls back if not in the set. */
export function paramEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = paramString(value, fallback);
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
