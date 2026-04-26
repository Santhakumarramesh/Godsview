/**
 * PII / secret scrubber.
 *
 * Strips fields whose key matches the secret patterns from any object before
 * the object enters the in-memory log ring or the captured-error ring. The
 * scrubbed value is replaced with "[redacted]" so the structure is preserved
 * and operators can see that a field existed without seeing its value.
 *
 * NEVER add a key to the secret patterns list and expect it to be retroactive
 * — the ring already in memory is not re-scrubbed.
 */

const SECRET_KEY_RE = /(secret|token|key|password|passphrase|authorization|api[-_]?key|bearer|cookie|x[-_]webhook[-_]signature)/i;
const REDACTED = "[redacted]";

export function scrub<T = any>(value: T, depth = 0): T {
  if (depth > 8) return value; // bound recursion
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  }

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value as Record<string, any>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out as unknown as T;
}
