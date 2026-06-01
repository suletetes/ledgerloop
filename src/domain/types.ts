/**
 * Shared domain types for the Ledger Service core.
 *
 * These are the framework-free, dependency-free shapes that flow between the
 * pure domain components (Split_Calculator, Balance_Engine, Debt_Simplifier,
 * Settlement_Validator, Currency_Display) and the orchestration layer. They are
 * defined here verbatim from the design's "Shared domain types" section so the
 * correctness invariants can be reasoned about independently of persistence.
 *
 * ## Integer-only money discipline (INV-4, Req 12.1, 12.2)
 *
 * Every monetary amount in this codebase is an **integer count of minor units**
 * (e.g. cents for USD, pence for GBP) — never a major-unit decimal and never a
 * floating-point number, not even zero (Req 12.2). This is the single rule that
 * keeps balances exact:
 *
 * - **`number` is used only where the value is provably a safe integer.** All
 *   the `*Minor` fields below are typed `number` because they are constrained,
 *   at the validation boundary, to integers in the range
 *   `1 .. Number.MAX_SAFE_INTEGER` (or `0 .. MAX_SAFE_INTEGER` for shares). A
 *   JavaScript `number` represents every integer in
 *   `[-(2^53 − 1), 2^53 − 1]` exactly, so arithmetic on validated minor-unit
 *   amounts in this range incurs no rounding error.
 * - **`bigint` is used at the persistence boundary.** The database stores money
 *   as `BIGINT` (up to `2^63 − 1`), which exceeds `Number.MAX_SAFE_INTEGER`
 *   (`2^53 − 1`). Row types in the persistence layer therefore carry `bigint`
 *   for money columns and convert to/from the safe-integer `number` used here
 *   only after asserting the value is within safe range. The conversion lives
 *   at the boundary; the pure core never sees a `bigint`.
 * - **No floating point, ever.** Splits, percentages, and FX conversion are all
 *   computed with integer arithmetic (e.g. `Math.floor`, parts-per-million
 *   rates) so a fractional intermediate can never become a stored amount.
 *
 * The `Minor` suffix on a field name is the convention that marks "this is an
 * integer in minor units." Major-unit values entered by a member are converted
 * to integer minor units in the Web UI before they ever reach these types
 * (Req 12.4).
 */

/**
 * How an expense's amount is divided among its participants.
 *
 * - `"equal"`   — split evenly; the remainder (when the amount does not divide
 *                 evenly) is distributed deterministically (Req 7.1, 7.2).
 * - `"percent"` — split by per-participant percentages that must sum to exactly
 *                 100 (Req 7.3, 7.4).
 * - `"exact"`   — split by explicit per-participant minor-unit shares that must
 *                 sum to exactly the amount (Req 7.5, 7.6).
 */
export type SplitType = "equal" | "percent" | "exact";

/**
 * A single participant's share of an expense.
 *
 * @property userId     - The member who owes this portion of the expense.
 * @property shareMinor - The portion owed, as a non-negative integer in minor
 *                        units (Req 7.8). Across an expense's splits these sum
 *                        exactly to the expense amount (INV-1, Req 7.9).
 */
export interface Split {
  userId: string;
  shareMinor: number;
}

/**
 * The validated input required to record an expense.
 *
 * Field rules (enforced at the write boundary before any split is computed or
 * any row is written — Req 6.2–6.5, 6.9, 6.10):
 *
 * @property groupId      - The group the expense belongs to.
 * @property paidBy       - The member who paid; must be a member of `groupId`.
 * @property amountMinor  - Positive integer in minor units, `1 .. 2^53 − 1` at
 *                          this layer (INV-4). Storage permits up to `2^63 − 1`
 *                          via `bigint`; values beyond the safe-integer range
 *                          are handled at the persistence boundary, never here.
 * @property currency     - ISO-4217 three-letter code, validated.
 * @property description  - 1..500 characters, non-whitespace.
 * @property splitType    - One of {@link SplitType}.
 * @property participants - Non-empty list of members sharing the expense.
 * @property percents     - Required when `splitType === "percent"`; positional,
 *                          aligned to `participants`; must sum to exactly 100.
 * @property exactShares  - Required when `splitType === "exact"`; positional,
 *                          aligned to `participants`; integer minor units that
 *                          must sum to exactly `amountMinor`.
 */
export interface ExpenseInput {
  groupId: string;
  /** The member who paid (must be a group member). */
  paidBy: string;
  /** Positive integer, minor units (INV-4). */
  amountMinor: number;
  /** ISO-4217, validated. */
  currency: string;
  /** 1..500 chars, non-whitespace. */
  description: string;
  splitType: SplitType;
  /** Members sharing the expense (non-empty). */
  participants: string[];
  /** Required for 'percent', aligned positionally to `participants`. */
  percents?: number[];
  /** Required for 'exact', aligned positionally to `participants`. */
  exactShares?: number[];
}

/**
 * The validated input required to record a settlement (a payment one member
 * makes to another to reduce a debt).
 *
 * @property groupId     - The group the settlement belongs to.
 * @property fromUser    - The payer; must be a member of `groupId` and must not
 *                         equal `toUser` (Req 8.8).
 * @property toUser      - The receiver; must be a member of `groupId`.
 * @property amountMinor - Positive integer in minor units; capped at the amount
 *                         the payer currently owes the receiver (INV-5, Req 8.6).
 * @property currency    - ISO-4217 three-letter code, validated.
 */
export interface SettlementInput {
  groupId: string;
  /** The payer. */
  fromUser: string;
  /** The receiver. */
  toUser: string;
  /** Positive integer, minor units. */
  amountMinor: number;
  /** ISO-4217, validated. */
  currency: string;
}

/**
 * A single payer-to-receiver transfer.
 *
 * Used both for the simplified-debt plan emitted by the Debt_Simplifier and for
 * the pairwise "who owes whom" derivation that backs settle-up pre-fill and the
 * INV-5 settlement cap.
 *
 * @property from        - The paying member.
 * @property to          - The receiving member (distinct from `from`).
 * @property amountMinor - Positive integer in minor units (Req 10.7).
 */
export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}
