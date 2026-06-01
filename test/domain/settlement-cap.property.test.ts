/**
 * Property test for the settlement cap (task 6.2).
 *
 * Property 14: Settlement cap (INV-5)
 * (design: Components and Interfaces — Settlement_Validator; Testing Strategy).
 *
 * Validates Requirements 8.6, 8.7 — the Settlement_Validator SHALL require that
 * a Settlement's amount does not exceed the amount the paying Member currently
 * owes the receiving Member, derived from the Group's append-only ledger
 * (Req 8.6); and IF the amount exceeds that derived cap, THEN it SHALL reject
 * the Settlement, return a message stating the maximum settleable amount, and
 * leave the Group's ledger unchanged (Req 8.7).
 *
 * The property exercises the *iff* at the heart of INV-5: for any group ledger
 * and any candidate settlement from payer `P` to receiver `R` whose structural
 * fields are all valid (present group/payer/receiver, valid ISO-4217 currency,
 * positive-integer amount, and `P !== R`), `validate` accepts the settlement
 * exactly when its amount does not exceed `maxSettleable(snapshot, P, R)`. When
 * the amount exceeds that cap, the rejection is a `validation` error on
 * `amountMinor` carrying `maxSettleableMinor === cap` (Req 8.7).
 *
 * Strategy: generate a valid base `LedgerSnapshot` — distinct members, optional
 * expenses whose `equalSplit` shares sum to the amount (so the base honours
 * INV-1), and optional prior settlements between distinct members — then pick a
 * distinct `(P, R)` pair and compute `cap = maxSettleable(snapshot, P, R)`. The
 * candidate amount `A` is drawn so it is *sometimes* within the cap and
 * *sometimes* above it (an at-or-below draw in `1..cap` plus an always-above
 * draw in `cap+1..cap+window`), guaranteeing both branches of the iff are
 * tested. Magnitudes are kept modest so every derived running sum stays well
 * within `Number.MAX_SAFE_INTEGER`.
 *
 * `validate` is a pure function that returns a `Result` and writes nothing, so
 * "the ledger is left unchanged" is inherent — there is no mutable state it
 * could touch — and is therefore not separately asserted here.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code } from "../helpers/generators";
import {
  maxSettleable,
  validate,
  equalSplit,
  type LedgerSnapshot,
  type SettlementInput,
} from "@/domain";

/** Modest magnitude ceiling so summed ledgers stay safe-integer exact. */
const MAX_MINOR = 100_000;

/** How far above the cap the always-above amount draw may reach. */
const ABOVE_CAP_WINDOW = 1_000_000;

interface SettlementCapCase {
  snapshot: LedgerSnapshot;
  payer: string;
  receiver: string;
  cap: number;
  amount: number;
  currency: string;
}

/** Two DISTINCT members drawn from the group's member set. */
function distinctPair(members: string[]): fc.Arbitrary<[string, string]> {
  return fc
    .uniqueArray(fc.constantFrom(...members), { minLength: 2, maxLength: 2 })
    .map(([from, to]) => [from, to] as [string, string]);
}

/**
 * A valid base ledger, a distinct `(payer, receiver)` pair, the derived INV-5
 * cap for that pair, and a candidate amount that straddles the cap (both
 * within-cap and over-cap cases occur). The base may carry INV-1-respecting
 * expenses and prior settlements so the cap is exercised against non-trivial
 * derived debts, not just an empty ledger.
 */
function settlementCapCase(): fc.Arbitrary<SettlementCapCase> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 })
    .chain((members) => {
      const expenseSpec = fc.record({
        paidBy: fc.constantFrom(...members),
        amountMinor: fc.integer({ min: 1, max: MAX_MINOR }),
        currency: iso4217Code(),
        participants: fc.subarray(members, { minLength: 1 }),
      });

      const settlementSpec = fc.record({
        pair: distinctPair(members),
        amountMinor: fc.integer({ min: 1, max: MAX_MINOR }),
        currency: iso4217Code(),
      });

      return fc
        .record({
          expenseSpecs: fc.array(expenseSpec, { maxLength: 5 }),
          baseSettlementSpecs: fc.array(settlementSpec, { maxLength: 4 }),
          payerReceiver: distinctPair(members),
          currency: iso4217Code(),
        })
        .chain(
          ({ expenseSpecs, baseSettlementSpecs, payerReceiver, currency }) => {
            const expenses = expenseSpecs.map((spec, i) => ({
              id: `exp-${i}`,
              paidBy: spec.paidBy,
              amountMinor: spec.amountMinor,
              currency: spec.currency,
            }));

            // Splits sum to the expense amount via equalSplit (INV-1), so the
            // base snapshot is internally consistent.
            const splits = expenseSpecs.flatMap((spec, i) =>
              equalSplit(spec.amountMinor, spec.participants).map((share) => ({
                expenseId: `exp-${i}`,
                userId: share.userId,
                shareMinor: share.shareMinor,
              })),
            );

            const settlements = baseSettlementSpecs.map((spec) => ({
              fromUser: spec.pair[0],
              toUser: spec.pair[1],
              amountMinor: spec.amountMinor,
              currency: spec.currency,
            }));

            const snapshot: LedgerSnapshot = {
              members,
              expenses,
              splits,
              settlements,
            };

            const [payer, receiver] = payerReceiver;
            const cap = maxSettleable(snapshot, payer, receiver);

            // Draw an amount that straddles the cap: an at-or-below value in
            // 1..cap (only when the cap admits one) AND an always-above value
            // in cap+1..cap+window, so both branches of the iff are tested.
            const aboveCap = fc.integer({
              min: cap + 1,
              max: cap + ABOVE_CAP_WINDOW,
            });
            const amount =
              cap >= 1
                ? fc.oneof(fc.integer({ min: 1, max: cap }), aboveCap)
                : aboveCap;

            return amount.map((amountMinor) => ({
              snapshot,
              payer,
              receiver,
              cap,
              amount: amountMinor,
              currency,
            }));
          },
        );
    });
}

describe("Settlement_Validator — Property 14", () => {
  // Feature: ledgerloop-app, Property 14: Settlement cap (INV-5)
  it("accepts a settlement iff its positive-integer amount does not exceed the derived cap, reporting the maximum on a cap rejection", () => {
    assertProperty(
      fc.property(settlementCapCase(), (testCase) => {
        const { snapshot, payer, receiver, cap, amount, currency } = testCase;

        const input: SettlementInput = {
          groupId: "grp-1",
          fromUser: payer,
          toUser: receiver,
          amountMinor: amount,
          currency,
        };

        const result = validate(snapshot, input);

        // The amount is a positive integer and all structural fields are valid
        // by construction, so acceptance hinges solely on the INV-5 cap: accept
        // iff amount <= cap (Req 8.6).
        const withinCap = amount <= cap;
        expect(result.ok).toBe(withinCap);

        if (result.ok) {
          // Accepted: the amount is a positive integer within the cap.
          expect(Number.isInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(1);
          expect(amount).toBeLessThanOrEqual(cap);
        } else {
          // Rejected for exceeding the cap: a field-scoped validation error
          // that reports the maximum settleable amount (Req 8.7).
          expect(amount).toBeGreaterThan(cap);
          expect(result.error.category).toBe("validation");
          expect(result.error.field).toBe("amountMinor");
          expect(result.error.maxSettleableMinor).toBe(cap);
        }
      }),
    );
  });
});
