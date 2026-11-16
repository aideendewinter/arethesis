/**
 * Exponential backoff with jitter, shared by HTTP retries and reconnects.
 *
 * @module utils/backoff
 */

export interface BackoffOptions {
  /** First delay in ms. @default 1000 */
  baseDelay?: number;
  /** Upper bound in ms. @default 30000 */
  maxDelay?: number;
  /** Random extra delay as a fraction of the delay (0–1). @default 0.3 */
  jitter?: number;
}

/** Delay before attempt `attempt` (0-based). */
export function computeBackoff(attempt: number, options: BackoffOptions = {}, random = Math.random): number {
  const base = options.baseDelay ?? 1000;
  const max = options.maxDelay ?? 30000;
  const jitter = options.jitter ?? 0.3;
  const exponential = Math.min(base * 2 ** attempt, max);
  return Math.min(exponential + random() * jitter * exponential, max);
}

/** Promise-based sleep that rejects if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
