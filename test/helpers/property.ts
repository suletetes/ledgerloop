/**
 * Property-test helper (task 1.2, Req 19.2).
 *
 * Wraps `fast-check`'s `assert` + `property`/`asyncProperty` so every
 * property-based test in LedgerLoop runs a minimum of 100 iterations, as the
 * design's Testing Strategy mandates ("each property test runs a minimum of
 * 100 iterations"). Callers may raise `numRuns` but never lower it below 100.
 *
 * ## Tagging convention
 *
 * Each property test MUST be tagged with a comment referencing its design
 * Property, in the exact format:
 *
 *   // Feature: ledgerloop-app, Property {n}: {text}
 *
 * Example:
 *
 *   // Feature: ledgerloop-app, Property 2: Equal-split fairness and determinism
 *   it("equal split is fair and deterministic", () => {
 *     assertProperty(fc.property(fc.array(fc.string()), (xs) => { ... }));
 *   });
 *
 * The `{n}` is the design Property number (1–27) and `{text}` is that
 * Property's title from design.md. Exactly one property-based test is written
 * per design Property.
 */
import fc from "fast-check";

/** Minimum iterations every property test must run (design: Testing Strategy). */
export const MIN_NUM_RUNS = 100;

/**
 * The effective `fast-check` parameters used for a run, after the
 * 100-iteration floor has been applied. Returned by {@link resolveParameters}
 * so the floor logic can be unit-tested without invoking `fc.assert`.
 */
export type ResolvedParameters<T> = fc.Parameters<T> & { numRuns: number };

/**
 * Apply the LedgerLoop iteration floor to caller-supplied fast-check
 * parameters. A caller may request MORE than {@link MIN_NUM_RUNS} runs, but a
 * request for fewer (or an unspecified count) is raised to the floor.
 */
export function resolveParameters<T>(
  params?: fc.Parameters<T>,
): ResolvedParameters<T> {
  const requested = params?.numRuns;
  const numRuns =
    typeof requested === "number" && requested > MIN_NUM_RUNS
      ? requested
      : MIN_NUM_RUNS;
  return { ...(params ?? {}), numRuns };
}

/**
 * Run a synchronous property with the enforced ≥100-iteration floor.
 *
 * Thin wrapper over `fc.assert(property, params)` that guarantees the run
 * count never drops below {@link MIN_NUM_RUNS}. Use this in place of calling
 * `fc.assert` directly so the floor is applied uniformly.
 */
export function assertProperty<Ts>(
  property: fc.IProperty<Ts>,
  params?: fc.Parameters<Ts>,
): void {
  fc.assert(property, resolveParameters(params));
}

/**
 * Run an asynchronous property with the enforced ≥100-iteration floor.
 *
 * Mirrors {@link assertProperty} for properties returning promises (e.g. the
 * persistence-backed properties that run against the in-memory fake).
 */
export async function assertAsyncProperty<Ts>(
  property: fc.IAsyncProperty<Ts>,
  params?: fc.Parameters<Ts>,
): Promise<void> {
  await fc.assert(property, resolveParameters(params));
}

/** Re-export `fast-check` so tests import everything from one helper module. */
export { fc };
