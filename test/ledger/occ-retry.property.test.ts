/**
 * Property-based test for OCC retry semantics (INV-3 wrapper).
 *
 * Validates: Requirements 11.2, 11.4
 */
import { describe, it } from "vitest";
import { fc, assertAsyncProperty } from "../helpers/property";
import { withOccRetry, OccExhaustedError } from "@/ledger";

// Feature: ledgerloop-app, Property 18: OCC retry semantics (INV-3 wrapper)
describe("Property 18: OCC retry semantics (INV-3 wrapper)", () => {
  /**
   * **Validates: Requirements 11.2, 11.4**
   *
   * Property 18: "For any operation that fails with SQLSTATE 40001 on the first
   * k attempts and then succeeds, withOccRetry returns the successful result
   * when k is below the bounded retry limit; for any operation that always fails
   * with 40001, it stops after the bounded number of attempts and returns a
   * conflict-exhausted error without committing."
   */
  it("retries on 40001 up to the bounded limit and re-throws non-40001 immediately", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        // max attempts: 1..6
        fc.integer({ min: 1, max: 6 }),
        // k: number of 40001 failures before success (0..max+2)
        fc.integer({ min: 0, max: 8 }),
        // successValue: the value returned on success
        fc.anything(),
        // nonOccErrorMessage: for testing non-40001 re-throw
        fc.string({ minLength: 1, maxLength: 50 }),
        async (max, rawK, successValue, nonOccErrorMessage) => {
          // Clamp k to [0, max+2] based on actual max
          const k = Math.min(rawK, max + 2);

          // No-op delay for speed
          const noOpDelay = async () => {};

          // --- Test 1: 40001 failures followed by success ---
          let callCount = 0;
          const fn = async () => {
            callCount++;
            if (callCount <= k) {
              const err = new Error("serialization_failure");
              (err as unknown as Record<string, unknown>).code = "40001";
              throw err;
            }
            return successValue;
          };

          if (k < max) {
            // Should succeed: k failures then success within the limit
            const result = await withOccRetry(fn, { max, delay: noOpDelay });
            if (result !== successValue) {
              throw new Error(
                `Expected withOccRetry to return the success value when k(${k}) < max(${max})`,
              );
            }
          } else {
            // Should exhaust: k >= max means all attempts fail with 40001
            let threw = false;
            let caughtError: unknown;
            try {
              await withOccRetry(fn, { max, delay: noOpDelay });
            } catch (err) {
              threw = true;
              caughtError = err;
            }
            if (!threw) {
              throw new Error(
                `Expected OccExhaustedError when k(${k}) >= max(${max})`,
              );
            }
            if (!(caughtError instanceof OccExhaustedError)) {
              throw new Error(
                `Expected OccExhaustedError but got ${String(caughtError)}`,
              );
            }
          }

          // --- Test 2: Non-40001 errors re-throw immediately without retry ---
          let nonOccCallCount = 0;
          const nonOccFn = async () => {
            nonOccCallCount++;
            const err = new Error(nonOccErrorMessage);
            (err as unknown as Record<string, unknown>).code = "ECONNREFUSED";
            throw err;
          };

          let nonOccThrew = false;
          let nonOccCaughtError: unknown;
          try {
            await withOccRetry(nonOccFn, { max, delay: noOpDelay });
          } catch (err) {
            nonOccThrew = true;
            nonOccCaughtError = err;
          }

          if (!nonOccThrew) {
            throw new Error("Expected non-40001 error to be re-thrown immediately");
          }
          if (
            !(nonOccCaughtError instanceof Error) ||
            nonOccCaughtError.message !== nonOccErrorMessage
          ) {
            throw new Error(
              "Expected the original non-40001 error to be re-thrown unchanged",
            );
          }
          // Non-40001 errors should NOT be retried — only 1 call
          if (nonOccCallCount !== 1) {
            throw new Error(
              `Expected exactly 1 call for non-40001 error, got ${nonOccCallCount}`,
            );
          }

          return true;
        },
      ),
    );
  });
});
