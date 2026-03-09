/**
 * Tests for the sliding window rate limiter.
 *
 * Verifies allow/reject logic and sliding window expiration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows calls within the limit", () => {
    const limiter = new RateLimiter(3, 60000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("rejects calls exceeding the limit", () => {
    const limiter = new RateLimiter(3, 60000);
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("allows calls after window slides past oldest entry", () => {
    const limiter = new RateLimiter(2, 1000);

    // Use up the limit
    expect(limiter.tryAcquire()).toBe(true); // t=0
    expect(limiter.tryAcquire()).toBe(true); // t=0
    expect(limiter.tryAcquire()).toBe(false); // rejected

    // Advance time past the window
    vi.advanceTimersByTime(1001);

    // Old entries expired, new calls should be allowed
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("correctly prunes only expired entries", () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.tryAcquire()).toBe(true); // t=0

    vi.advanceTimersByTime(500);
    expect(limiter.tryAcquire()).toBe(true); // t=500

    // At t=500, both entries are within window, so 3rd should fail
    expect(limiter.tryAcquire()).toBe(false);

    // Advance to t=1001: first entry (t=0) expires, second (t=500) still valid
    vi.advanceTimersByTime(501);
    expect(limiter.tryAcquire()).toBe(true); // allowed (only 1 in window)
    expect(limiter.tryAcquire()).toBe(false); // rejected (2 in window again)
  });

  it("reset clears all entries", () => {
    const limiter = new RateLimiter(1, 60000);
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    limiter.reset();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("handles high-volume usage correctly", () => {
    const limiter = new RateLimiter(10, 60000);
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });
});
