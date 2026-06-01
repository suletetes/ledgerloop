/**
 * The `Result<T>` / `DomainError` model used across the domain core.
 *
 * Every fallible domain operation returns a {@link Result} rather than throwing,
 * so callers must handle both outcomes explicitly and the type system tracks
 * which branch they are in. A failure carries a structured {@link DomainError}
 * whose `category` lets the API boundary map it to an HTTP status and a
 * user-safe, PII-free message that indicates whether the operation took effect
 * (Req 22.1, 22.2).
 *
 * The model is pure and dependency-free; it imposes no I/O and no framework
 * coupling, matching the "pure domain core" constraint of the design.
 */

/**
 * The outcome of a fallible domain operation: either a value, or a structured
 * domain error. This is a discriminated union on the `ok` field, so narrowing
 * on `result.ok` gives access to `result.value` or `result.error` respectively.
 *
 * @typeParam T - The success payload type.
 *
 * @example
 * const r = validate(input);
 * if (!r.ok) return r.error; // r is { ok: false; error: DomainError }
 * use(r.value);              // r is { ok: true; value: T }
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

/**
 * The categories of domain failure. Each maps to a distinct API/HTTP treatment
 * at the boundary (Req 22.2):
 *
 * - `"validation"`            — input failed a field or structural rule (Req 6.4,
 *                               8.4, 8.5); typically carries `field`.
 * - `"authorization"`         — caller (or a referenced member) is not a member
 *                               of the group; carries no group contents (Req 5.2).
 * - `"not_found"`             — referenced group/member/membership does not exist
 *                               (Req 4.3, 13.3).
 * - `"referential_integrity"` — a write referenced a non-existent entity (INV-6,
 *                               Req 13.3).
 * - `"invariant"`             — a correctness invariant would be violated.
 * - `"conflict_exhausted"`    — OCC retries were exhausted; ledger unchanged
 *                               (Req 11.4).
 * - `"unavailable"`           — persistence/dependency is unavailable (Req 22.3).
 */
export type DomainErrorCategory =
  | "validation"
  | "authorization"
  | "not_found"
  | "referential_integrity"
  | "invariant"
  | "conflict_exhausted"
  | "unavailable";

/**
 * A structured, user-safe description of a domain failure.
 *
 * @property category            - The failure {@link DomainErrorCategory}.
 * @property field               - For validation errors, the offending input
 *                                 field, so the UI can show the reason next to
 *                                 the relevant control (Req 6.4, 8.4, 8.5, 22.4).
 * @property message             - A user-safe, PII-free message (Req 21.4). Must
 *                                 never include another member's email or other
 *                                 personal data.
 * @property maxSettleableMinor  - For an INV-5 settlement-cap rejection, the
 *                                 maximum the payer may settle to the receiver
 *                                 right now, as an integer in minor units, so the
 *                                 UI can state the maximum (Req 8.7).
 */
export interface DomainError {
  category: DomainErrorCategory;
  /** For validation errors (Req 6.4, 8.4, 8.5). */
  field?: string;
  /** User-safe, PII-free (Req 21.4). */
  message: string;
  /** For INV-5 rejections (Req 8.7). Integer minor units. */
  maxSettleableMinor?: number;
}

/**
 * Optional, structured extras for a {@link DomainError}. Kept separate from
 * `message` so callers never have to encode machine-readable detail into prose.
 */
export interface DomainErrorExtra {
  /** The offending input field, for validation errors. */
  field?: string;
  /** The settlement cap in minor units, for INV-5 rejections (Req 8.7). */
  maxSettleableMinor?: number;
}

/**
 * Construct a successful {@link Result}.
 *
 * @typeParam T - The success payload type.
 * @param value - The success value.
 * @returns A `{ ok: true; value }` result.
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/**
 * Construct a failed {@link Result} carrying a {@link DomainError}.
 *
 * Only the fields supplied in `extra` are attached, so a `DomainError` never
 * carries an explicit `undefined` for `field` or `maxSettleableMinor`.
 *
 * @typeParam T   - The success payload type the caller expected (the returned
 *                  result is the failure branch, so `T` is never produced).
 * @param category - The failure {@link DomainErrorCategory}.
 * @param message  - A user-safe, PII-free message (Req 21.4).
 * @param extra    - Optional structured detail ({@link DomainErrorExtra}).
 * @returns A `{ ok: false; error }` result.
 */
export function err<T = never>(
  category: DomainErrorCategory,
  message: string,
  extra?: DomainErrorExtra,
): Result<T> {
  const error: DomainError = { category, message };
  if (extra?.field !== undefined) {
    error.field = extra.field;
  }
  if (extra?.maxSettleableMinor !== undefined) {
    error.maxSettleableMinor = extra.maxSettleableMinor;
  }
  return { ok: false, error };
}

/**
 * Type guard narrowing a {@link Result} to its success branch.
 *
 * @typeParam T - The success payload type.
 * @param result - The result to inspect.
 * @returns `true` when `result` is `{ ok: true; value }`.
 */
export function isOk<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Type guard narrowing a {@link Result} to its failure branch.
 *
 * @typeParam T - The success payload type.
 * @param result - The result to inspect.
 * @returns `true` when `result` is `{ ok: false; error }`.
 */
export function isErr<T>(
  result: Result<T>,
): result is { ok: false; error: DomainError } {
  return !result.ok;
}
