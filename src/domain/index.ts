/**
 * Domain core (pure logic, no I/O).
 *
 * This layer holds the pure, framework-free domain logic that enforces the
 * correctness invariants before any persistence exists:
 *   - Split_Calculator       (INV-1)  — see tasks 3.x
 *   - Balance_Engine          (INV-2)  — see tasks 4.x
 *   - Debt_Simplifier                  — see tasks 5.x
 *   - Settlement_Validator    (INV-5)  — see tasks 6.x
 *   - Currency_Display                 — see tasks 7.x
 *   - shared domain types + money utilities (INV-4) — types in task 2.1,
 *     ISO-4217 validation + minor-units conversion in task 2.2
 *
 * Everything here is a pure function over in-memory inputs so the invariants
 * can be property-tested independently of the database (design: Overview,
 * Components and Interfaces).
 *
 * Further implementations are added by later tasks; this barrel re-exports the
 * layer's public surface as it lands.
 */

// Shared domain types (task 2.1): SplitType, Split, ExpenseInput,
// SettlementInput, Transfer — see ./types.ts.
export type {
  SplitType,
  Split,
  ExpenseInput,
  SettlementInput,
  Transfer,
} from "./types";

// Result/DomainError model (task 2.1) — see ./result.ts.
export type {
  Result,
  DomainError,
  DomainErrorCategory,
  DomainErrorExtra,
} from "./result";
export { ok, err, isOk, isErr } from "./result";

// ISO-4217 validation + integer minor-units money utilities (task 2.2, INV-4)
// — see ./money.ts.
export {
  CURRENCY_MINOR_DIGITS,
  isValidCurrency,
  currencyMinorDigits,
  parseMajorToMinor,
  formatMinor,
} from "./money";

// Split_Calculator (INV-1). Task 3.1 lands `equalSplit`; task 3.3 adds
// `percentSplit` and `exactSplit` to the same module — see
// ./split-calculator.ts.
export {
  equalSplit,
  percentSplit,
  exactSplit,
  SplitCalculator,
} from "./split-calculator";

// Debt_Simplifier (task 5.1): greedy min-cashflow plan over derived net
// positions, pure read-path function — see ./debt-simplifier.ts.
export { simplifyDebts, DebtSimplifier } from "./debt-simplifier";

// Balance_Engine (INV-2, task 4.1): net-position + pairwise-debt derivation
// over a ledger snapshot, using the corrected settlement sign convention
// (+paid - owed + settled_out - settled_in) - see ./balance-engine.ts.
export type {
  LedgerSnapshot,
  SnapshotExpense,
  SnapshotSplit,
  SnapshotSettlement,
} from "./balance-engine";
export {
  deriveNetPositions,
  derivePairwiseDebts,
  BalanceEngine,
} from "./balance-engine";

// Settlement_Validator (INV-5, task 6.1): pure, snapshot-based settlement
// validation — the INV-5 cap (`maxSettleable`) derived from the ledger plus the
// ordered structural checks (`validate`). The persistence-backed wiring that
// loads the snapshot lives in the recordSettlement orchestration (task 12.5) —
// see ./settlement-validator.ts.
export {
  maxSettleable,
  validate,
  SettlementValidator,
} from "./settlement-validator";

// Currency_Display (task 7.1): read-time FX conversion for multi-currency
// display. Converts stored amounts to a viewer's preferred currency using
// integer-friendly ratePpm arithmetic; never mutates stored data (Req 14.1,
// 14.5). Same-currency is identity and always available. — see
// ./currency-display.ts.
export type {
  FxRate,
  FxRateCache,
  ConvertedResult,
  NotConvertedResult,
  ConvertResult,
} from "./currency-display";
export { convert, lookupRate, CurrencyDisplay } from "./currency-display";
