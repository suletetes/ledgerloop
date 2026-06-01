/**
 * Settlement_Validator — guards a settlement before it is recorded (INV-5).
 *
 * A settlement is one member paying another to reduce a debt. Before any
 * settlement row is appended, it must pass two kinds of check:
 *
 *   1. **Structural validation** (Req 8.2–8.5, 8.8) — the required fields are
 *      present, the amount is a positive integer in minor units, the currency
 *      is a valid ISO-4217 code, and the payer and receiver are different
 *      members.
 *   2. **The INV-5 cap** (Req 8.6, 8.7) — the amount may not exceed what the
 *      payer *currently owes* the receiver. That "owed" figure is **derived
 *      from the append-only ledger**, never read from a stored balance: it is
 *      the pairwise debt the {@link import("./balance-engine").BalanceEngine}
 *      computes (`derivePairwiseDebts`). Over-settling is rejected with the
 *      maximum carried back on `maxSettleableMinor` so the UI can state the cap.
 *
 * Both functions are **pure**: `validate` returns a {@link Result} and writes
 * nothing, so every rejection leaves the ledger unchanged (Req 8.4, 8.5, 8.7,
 * 8.8). All arithmetic is integer minor-units arithmetic (INV-4).
 *
 * ## Pure-core variant (snapshot in, no persistence)
 *
 * The design's `Settlement_Validator` interface shows persistence-backed,
 * `Promise`-returning signatures — `maxSettleable(groupId, fromUser, toUser)`
 * and `validate(input)` — that load the group's ledger from `Persistence`.
 * Persistence does not exist yet (it is built in tasks 9 and 14), and this
 * module belongs to the pure-core wave. It therefore implements the **pure,
 * synchronous variant**: both functions take an in-memory {@link LedgerSnapshot}
 * (exactly as the Balance_Engine and Debt_Simplifier do) instead of a group id,
 * so the INV-5 cap can be derived and property-tested with no I/O.
 *
 * The persistence-backed wiring — loading the snapshot for a `groupId` via
 * `Persistence.loadLedger`, then delegating to these pure functions — is the
 * `recordSettlement` orchestration's job (task 12.5). Authorization and
 * membership checks (payer/receiver are group members) are likewise **not**
 * duplicated here; they are the `Auth_Guard`'s responsibility (task 10). This
 * module is concerned solely with INV-5 and structural field validation.
 */

import { derivePairwiseDebts, type LedgerSnapshot } from "./balance-engine";
import { err, ok, type Result } from "./result";
import type { SettlementInput } from "./types";
import { isValidCurrency } from "./money";

/**
 * Whether a required field value is missing.
 *
 * "Missing" means the value was not supplied at all (`undefined`/`null`) or is
 * a string that is empty or only whitespace. A supplied-but-invalid value (a
 * non-positive amount, a `NaN`, an unknown currency code) is **not** treated as
 * missing here — it is "present" and falls through to the value-level checks in
 * {@link validate}, which report it with the appropriate field and message.
 *
 * The parameter is `unknown` so the runtime guards can be expressed without
 * tripping TypeScript's "no overlap" comparison errors on the statically typed
 * {@link SettlementInput} fields.
 *
 * @param value - The field value to inspect.
 * @returns `true` when the field should be reported as a missing required field.
 */
function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string" && value.trim() === "") {
    return true;
  }
  return false;
}

/**
 * Derive the maximum the payer (`fromUser`) may settle to the receiver
 * (`toUser`) right now, in minor units — the INV-5 cap (Req 8.6).
 *
 * This is the pairwise amount `fromUser` currently owes `toUser`, taken from
 * the group's **simplified pairwise debts** derived from the append-only ledger
 * by {@link derivePairwiseDebts} (the same derivation the settle-up pre-fill
 * uses). No stored balance is read; the figure is a pure function of the
 * snapshot.
 *
 * The simplified debt set contains at most one transfer for any ordered
 * `(from, to)` pair, so the cap is that transfer's `amountMinor` when a matching
 * payer→receiver transfer exists, and `0` otherwise. A `0` cap means the payer
 * owes the receiver nothing in the simplified plan (they may even be a net
 * creditor toward them), so any positive settlement between them is rejected by
 * {@link validate}.
 *
 * @param snapshot - The group's ledger read-model.
 * @param fromUser - The paying member.
 * @param toUser   - The receiving member.
 * @returns The cap in integer minor units (`>= 0`); `0` when the payer owes the
 *          receiver nothing.
 */
export function maxSettleable(
  snapshot: LedgerSnapshot,
  fromUser: string,
  toUser: string,
): number {
  const debts = derivePairwiseDebts(snapshot);
  for (const transfer of debts) {
    if (transfer.from === fromUser && transfer.to === toUser) {
      return transfer.amountMinor;
    }
  }
  return 0;
}

/**
 * Validate a settlement against the structural rules and the INV-5 cap,
 * producing nothing on failure so the ledger is left unchanged (Req 8.4, 8.5,
 * 8.7, 8.8).
 *
 * The checks run in a fixed order, and the **first** failure short-circuits
 * with a `validation` {@link Result} identifying the offending field:
 *
 *   1. **Required fields present** (Req 8.5). `groupId`, `fromUser`, `toUser`,
 *      `amountMinor`, and `currency` must all be supplied; the first missing one
 *      is reported via its field name.
 *   2. **Amount and currency are valid** (Req 8.2, 8.3, 8.4). `amountMinor` must
 *      be a positive integer in minor units (`field: "amountMinor"`); `currency`
 *      must be a valid ISO-4217 code (`field: "currency"`).
 *   3. **Payer ≠ receiver** (Req 8.8). A settlement may not name the same member
 *      as both payer and receiver (`field: "toUser"`).
 *   4. **Within the INV-5 cap** (Req 8.6, 8.7). `amountMinor` must not exceed
 *      {@link maxSettleable}; on exceed the rejection carries
 *      `maxSettleableMinor` set to the cap so the UI can state the maximum
 *      (`field: "amountMinor"`).
 *
 * On success the result is `ok(undefined)`: the settlement is structurally sound
 * and within what the payer owes. (Membership/authorization is checked
 * separately by the `Auth_Guard`, not here.)
 *
 * @param snapshot - The group's ledger read-model, used only to derive the
 *                   INV-5 cap; it is not mutated.
 * @param input    - The settlement to validate.
 * @returns `ok(undefined)` when the settlement is valid, or a `validation`
 *          {@link Result} naming the offending field (and, for a cap rejection,
 *          carrying `maxSettleableMinor`).
 */
export function validate(
  snapshot: LedgerSnapshot,
  input: SettlementInput,
): Result<void> {
  // 1. Required fields present (Req 8.5). Reported in a stable field order so a
  //    submission missing several fields always surfaces the same first cause.
  const requiredFields: ReadonlyArray<readonly [keyof SettlementInput, string]> = [
    ["groupId", "The group is required."],
    ["fromUser", "The paying member is required."],
    ["toUser", "The receiving member is required."],
    ["amountMinor", "The amount is required."],
    ["currency", "The currency is required."],
  ];
  for (const [field, message] of requiredFields) {
    if (isMissing(input[field])) {
      return err<void>("validation", message, { field });
    }
  }

  const { fromUser, toUser, amountMinor, currency } = input;

  // 2. Amount is a positive integer in minor units (Req 8.2), then currency is
  //    a valid ISO-4217 code (Req 8.3); each failure is field-scoped (Req 8.4).
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return err<void>(
      "validation",
      "Settlement amount must be a positive integer in minor units.",
      { field: "amountMinor" },
    );
  }
  if (!isValidCurrency(currency)) {
    return err<void>(
      "validation",
      "Currency is not a valid ISO-4217 code.",
      { field: "currency" },
    );
  }

  // 3. Payer and receiver must be different members (Req 8.8).
  if (fromUser === toUser) {
    return err<void>(
      "validation",
      "A settlement cannot have the same member as payer and receiver.",
      { field: "toUser" },
    );
  }

  // 4. The amount may not exceed what the payer currently owes the receiver,
  //    derived from the append-only ledger (INV-5, Req 8.6). On exceed, report
  //    the cap so the UI can state the maximum settleable (Req 8.7).
  const cap = maxSettleable(snapshot, fromUser, toUser);
  if (amountMinor > cap) {
    return err<void>(
      "validation",
      `Settlement amount exceeds the maximum settleable of ${String(cap)} minor units.`,
      { field: "amountMinor", maxSettleableMinor: cap },
    );
  }

  return ok<void>(undefined);
}

/**
 * The Settlement_Validator surface (design: Components and Interfaces —
 * Settlement_Validator). Groups the cap derivation and validation behind one
 * object so the orchestration layer (task 12.5) can depend on a single value,
 * mirroring the {@link import("./split-calculator").SplitCalculator} and
 * {@link import("./balance-engine").BalanceEngine} shapes.
 *
 * Both members are pure functions of the {@link LedgerSnapshot}; neither reads
 * nor writes a stored balance (INV-5 is enforced against the derived ledger).
 */
export const SettlementValidator = {
  /** The INV-5 cap: what the payer currently owes the receiver (Req 8.6). */
  maxSettleable,
  /** Structural + INV-5 validation, leaving the ledger unchanged on failure. */
  validate,
} as const;
