/**
 * Sliding window rate limiter.
 *
 * Provides configurable rate limiting for MCP tool invocations to prevent
 * runaway agent loops. Uses a simple sliding window algorithm that tracks
 * call timestamps and prunes expired entries on each check.
 */

export class RateLimiter {
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  /**
   * Create a new rate limiter.
   *
   * @param maxCalls - Maximum number of calls allowed within the window
   * @param windowMs - Window duration in milliseconds
   */
  constructor(maxCalls: number, windowMs: number) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }

  /**
   * Try to acquire a rate limit slot.
   *
   * @returns true if the call is allowed, false if rate limited
   */
  tryAcquire(): boolean {
    const now = Date.now();
    this.prune(now);

    if (this.timestamps.length >= this.maxCalls) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /**
   * Reset the rate limiter, clearing all tracked timestamps.
   */
  reset(): void {
    this.timestamps = [];
  }

  /**
   * Remove timestamps that have fallen outside the sliding window.
   */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.timestamps = this.timestamps.filter((ts) => ts > cutoff);
  }
}
