/**
 * OCC (Optimistic Concurrency Control) retry wrapper for Aurora DSQL.
 *
 * Aurora DSQL uses snapshot isolation with OCC: when two transactions conflict,
 * one is aborted with `SQLSTATE 40001` rather than silently losing an update.
 * This module provides a bounded retry loop with jittered exponential backoff
 * so that transient conflicts resolve automatically while exhausted retries
 * surface as a structured error the orchestration layer can handle.
 *
 * Convention:
 * - `withOccRetry` throws an `OccExhaustedError` when all attempts fail with
 *   SQLSTATE 40001. The orchestration layer catches this and converts it to
 *   `{ category: "conflict_exhausted" }` in the `Result` model.
 * - Non-40001 errors are re-thrown immediately (no retry).
 * - A success after one or more retries returns the same value as a
 *   first-attempt success (Req 11.6).
 *
 * @module
 */

/**
 * The SQLSTATE code Aurora DSQL emits for OCC write-write conflicts.
 */
export const OCC_CONFLICT = "40001";

/**
 * Options for the OCC retry wrapper.
 */
export interface OccRetryOptions {
  /**
   * Maximum number of attempts (including the first). Defaults to 4.
   * Must be at least 1.
   */
  max?: number;

  /**
   * Custom delay function for testability. Receives the number of milliseconds
   * to wait and returns a promise that resolves after that duration.
   * Defaults to a real `setTimeout`-based delay.
   */
  delay?: (ms: number) => Promise<void>;
}

/**
 * Error thrown when all OCC retry attempts are exhausted.
 * The orchestration layer should catch this and return
 * `{ category: "conflict_exhausted" }` to the caller.
 */
export class OccExhaustedError extends Error {
  /** The last SQLSTATE 40001 error that caused the final failure. */
  public override readonly cause: unknown;

  constructor(attempts: number, lastError: unknown) {
    super(
      `OCC retry exhausted after ${attempts} attempt(s); ledger unchanged.`,
    );
    this.name = "OccExhaustedError";
    this.cause = lastError;
  }
}

/**
 * The default delay function: waits the specified number of milliseconds
 * using `setTimeout`.
 */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes the backoff duration for a given attempt using jittered exponential
 * backoff: `base * 2^attempt + random jitter` where base = 25ms and jitter is
 * uniformly distributed in [0, 25)ms.
 *
 * @param attempt - Zero-based attempt index (0 = first retry after first failure).
 * @returns Duration in milliseconds.
 */
function computeBackoff(attempt: number): number {
  const base = 25;
  return base * 2 ** attempt + Math.random() * base;
}

/**
 * Extracts the SQLSTATE code from a database error object.
 * Checks both `err.code` (node-postgres convention) and `err.sqlState`
 * (alternative driver convention).
 */
function extractSqlState(err: unknown): string | undefined {
  if (err == null || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  if (typeof e.code === "string") return e.code;
  if (typeof e.sqlState === "string") return e.sqlState;
  return undefined;
}

/**
 * Executes `fn` with bounded OCC retry on SQLSTATE 40001.
 *
 * - On success (even after retries): returns the result normally (Req 11.6).
 * - On SQLSTATE 40001 with attempts remaining: waits with jittered exponential
 *   backoff, then retries against fresh state (Req 11.2, 11.3).
 * - On exhaustion (all attempts failed with 40001): throws {@link OccExhaustedError}
 *   so the orchestration layer can return `{ category: "conflict_exhausted" }`
 *   and the ledger remains unchanged (Req 11.4).
 * - On a non-40001 error: re-throws immediately without retry.
 *
 * @typeParam T - The return type of the wrapped function.
 * @param fn - The async operation to execute (typically a database transaction).
 * @param options - Optional configuration for max attempts and delay function.
 * @returns The result of `fn` on success.
 * @throws {OccExhaustedError} When all attempts are exhausted due to 40001 conflicts.
 * @throws The original error when a non-40001 error occurs.
 */
export async function withOccRetry<T>(
  fn: () => Promise<T>,
  options?: OccRetryOptions,
): Promise<T> {
  const max = options?.max ?? 4;
  const delay = options?.delay ?? defaultDelay;

  let lastError: unknown;

  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const sqlState = extractSqlState(err);

      if (sqlState !== OCC_CONFLICT) {
        // Non-40001 error: re-throw immediately, do not retry.
        throw err;
      }

      lastError = err;

      // If this was the last allowed attempt, break out to throw exhausted.
      if (attempt >= max - 1) {
        break;
      }

      // Wait with jittered exponential backoff before retrying.
      await delay(computeBackoff(attempt));
    }
  }

  // All attempts exhausted with 40001 conflicts.
  throw new OccExhaustedError(max, lastError);
}
