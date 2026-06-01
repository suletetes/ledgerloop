import { describe, it, expect } from "vitest";
import { withOccRetry, OccExhaustedError } from "@/ledger/occ-retry";

/**
 * Unit tests for bounded backoff between OCC retry attempts.
 * Validates: Requirements 11.3
 *
 * The backoff formula is: 25 * 2^attempt + jitter, where jitter ∈ [0, 25).
 * So for attempt 0: [25, 50), attempt 1: [50, 75), attempt 2: [100, 125), etc.
 */
describe("withOccRetry — bounded backoff between attempts", () => {
  /** Helper: creates a function that always throws a 40001 OCC conflict. */
  function alwaysConflict(): () => Promise<never> {
    return () => Promise.reject({ code: "40001" });
  }

  it("calls delay exactly max-1 times (between attempts, not after the last) and throws OccExhaustedError", async () => {
    const delayValues: number[] = [];
    const trackingDelay = (ms: number): Promise<void> => {
      delayValues.push(ms);
      return Promise.resolve();
    };

    await expect(
      withOccRetry(alwaysConflict(), { max: 4, delay: trackingDelay }),
    ).rejects.toBeInstanceOf(OccExhaustedError);

    // Between 4 attempts there are exactly 3 delays (between attempts, not after the last).
    expect(delayValues).toHaveLength(3);
  });

  it("each delay value follows the jittered exponential pattern: >= 25*2^attempt and < 25*2^attempt + 25", async () => {
    const delayValues: number[] = [];
    const trackingDelay = (ms: number): Promise<void> => {
      delayValues.push(ms);
      return Promise.resolve();
    };

    await expect(
      withOccRetry(alwaysConflict(), { max: 4, delay: trackingDelay }),
    ).rejects.toBeInstanceOf(OccExhaustedError);

    // Verify each delay is bounded by the jittered exponential formula.
    for (let attempt = 0; attempt < delayValues.length; attempt++) {
      const lowerBound = 25 * 2 ** attempt; // 25, 50, 100
      const upperBound = 25 * 2 ** attempt + 25; // 50, 75, 125

      expect(delayValues[attempt]).toBeGreaterThanOrEqual(lowerBound);
      expect(delayValues[attempt]).toBeLessThan(upperBound);
    }
  });

  it("with max=1, no delay is called (only one attempt, no retry)", async () => {
    const delayValues: number[] = [];
    const trackingDelay = (ms: number): Promise<void> => {
      delayValues.push(ms);
      return Promise.resolve();
    };

    await expect(
      withOccRetry(alwaysConflict(), { max: 1, delay: trackingDelay }),
    ).rejects.toBeInstanceOf(OccExhaustedError);

    // With only 1 attempt allowed, there are no retries and thus no delays.
    expect(delayValues).toHaveLength(0);
  });

  it("attempts never exceed the configured maximum", async () => {
    let attemptCount = 0;
    const fn = (): Promise<never> => {
      attemptCount++;
      return Promise.reject({ code: "40001" });
    };

    const trackingDelay = (_ms: number): Promise<void> => Promise.resolve();

    await expect(
      withOccRetry(fn, { max: 4, delay: trackingDelay }),
    ).rejects.toBeInstanceOf(OccExhaustedError);

    expect(attemptCount).toBe(4);
  });
});
