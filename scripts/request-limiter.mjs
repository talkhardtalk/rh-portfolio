export function createRequestLimiter({
  intervalMs = 250,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let nextAt = 0;
  let blockedUntil = 0;
  return {
    async wait() {
      // A later 429 can invalidate a slot that another caller has already reserved.
      do {
        const slot = Math.max(now(), nextAt, blockedUntil);
        nextAt = slot + intervalMs;
        const delay = slot - now();
        if (delay > 0) await sleep(delay);
      } while (now() < blockedUntil);
    },
    backoff(delayMs) {
      blockedUntil = Math.max(blockedUntil, now() + delayMs);
    },
  };
}
