/**
 * Phase 6 — Pure timeout + retry helper.
 *
 * Wraps an async function with:
 *   - a per-attempt timeout (Promise.race with an abort timer)
 *   - up to `maxRetries` retries on rejection (NOT on timeout abort by default)
 *   - exponential backoff between attempts: backoffMs * 2 ** attempt
 *
 * Intended for broker calls and DB queries that may transiently fail.
 * NOT a circuit breaker — failure cascades are still possible if the
 * caller invokes withRetry on every request.
 *
 * Pure: no logger, no global state. Caller is responsible for logging.
 */

export interface WithRetryOptions {
  /** Per-attempt timeout in ms. Default 10_000. Set to 0 to disable. */
  timeoutMs?: number;
  /** Number of retries AFTER the first attempt. Default 2 (= 3 attempts total). */
  maxRetries?: number;
  /** Base backoff in ms between attempts. Default 250. */
  backoffMs?: number;
  /** Optional: classify whether to retry. Default: retry on any thrown error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional clock injection for deterministic tests. */
  now?: () => number;
  /** Optional sleep injection for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryFailure extends Error {
  attempts: number;
  lastError: unknown;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Execute `fn` with timeout + retry. Returns the resolved value or throws
 * a RetryFailure carrying the final error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 250;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const sleep = opts.sleep ?? DEFAULT_SLEEP;

  let lastErr: unknown = new Error("withRetry: no attempt made");
  let attemptsMade = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attemptsMade = attempt + 1;
    try {
      if (timeoutMs > 0) {
        return await Promise.race([
          fn(),
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`withRetry: timeout after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries) break;
      if (!shouldRetry(err, attempt)) break;
      await sleep(backoffMs * 2 ** attempt);
    }
  }
  const wrapped: RetryFailure = Object.assign(
    new Error(
      `withRetry: failed after ${attemptsMade} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    ),
    { attempts: attemptsMade, lastError: lastErr },
  );
  throw wrapped;
}
