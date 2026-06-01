/**
 * Property test for settlement direction (task 4.4).
 *
 * Property 13: Settlement moves balances in the correct direction
 * (design: Testing Strategy, Balance_Engine sign convention).
 *
 * Validates Requirement 9.4 — recording a Settlement of amount `A` from payer
 * `P` to receiver `R` within a Group SHALL increase `P`'s derived Net_Position
 * by exactly `A` and decrease `R`'s derived Net_Position by exactly `A`.
 *
 * This is the explicit *direction* check the design calls out as the only thing
 * that catches a flipped settlement sign: INV-2 (sum-to-zero) holds for *either*
 * sign convention, so a zero-sum test alone cannot detect a flip. By diffing the
 * derived net positions before and after appending one settlement, a flipped
 * sign (P down / R up, or no movement) fails immediately.
 *
 * Strategy: generate a valid base `LedgerSnapshot` — distinct members, optional
 * expenses whose `equalSplit` shares sum to the amount (so the base honours
 * INV-1), and optional prior settlements between distinct members. Pick two
 * DISTINCT members `P` and `R` and a modest positive `A`, derive `net0`, append
 * exactly one settlement `{fromUser: P, toUser: R, amountMinor: A}`, derive
 * `net1`, and assert the directional movement plus that no other member moves.
 * Magnitudes are kept modest so every running sum stays well within
 * `Number.MAX_SAFE_INTEGER`.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code } from "../helpers/generators";
import {
  deriveNetPositions,
  equalSplit,
  type LedgerSnapshot,
} from "@/domain";

/** Modest magnitude ceiling so summed ledgers stay safe-integer exact. */
const MAX_MINOR = 1_000_000;

interface SettlementDirectionCase {
  snapshot: LedgerSnapshot;
  payer: string;
  receiver: string;
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
 * A valid base ledger plus a distinct (payer, receiver) pair and a positive
 * amount to settle. The base may carry expenses (with INV-1-respecting equal
 * splits) and prior settlements so the property exercises non-trivial starting
 * positions, not just an empty ledger.
 */
function settlementDirectionCase(): fc.Arbitrary<SettlementDirectionCase> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 2, maxLength: 6 })
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
          members: fc.constant(members),
          expenseSpecs: fc.array(expenseSpec, { maxLength: 5 }),
          baseSettlementSpecs: fc.array(settlementSpec, { maxLength: 4 }),
          payerReceiver: distinctPair(members),
          amount: fc.integer({ min: 1, max: MAX_MINOR }),
          currency: iso4217Code(),
        })
        .map(
          ({
            expenseSpecs,
            baseSettlementSpecs,
            payerReceiver,
            amount,
            currency,
          }) => {
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

            return {
              snapshot,
              payer: payerReceiver[0],
              receiver: payerReceiver[1],
              amount,
              currency,
            };
          },
        );
    });
}

describe("Balance_Engine.deriveNetPositions — Property 13", () => {
  // Feature: ledgerloop-app, Property 13: Settlement moves balances in the correct direction
  it("moves the payer's net up by A and the receiver's net down by A, leaving all others unchanged", () => {
    assertProperty(
      fc.property(settlementDirectionCase(), (testCase) => {
        const { snapshot, payer, receiver, amount, currency } = testCase;

        const net0 = deriveNetPositions(snapshot);

        // Append exactly one settlement P -> R of amount A; the base is left
        // untouched (append-only), so the diff isolates this settlement.
        const snapshotAfter: LedgerSnapshot = {
          ...snapshot,
          settlements: [
            ...snapshot.settlements,
            { fromUser: payer, toUser: receiver, amountMinor: amount, currency },
          ],
        };

        const net1 = deriveNetPositions(snapshotAfter);

        // Payer's net moves UP by exactly A (the +settled_out term).
        expect((net1.get(payer) ?? 0) - (net0.get(payer) ?? 0)).toBe(amount);

        // Receiver's net moves DOWN by exactly A (the -settled_in term). A
        // flipped sign would make this +A and fail here.
        expect((net1.get(receiver) ?? 0) - (net0.get(receiver) ?? 0)).toBe(
          -amount,
        );

        // Every other member's net position is unchanged by the settlement.
        for (const member of snapshot.members) {
          if (member !== payer && member !== receiver) {
            expect(net1.get(member)).toBe(net0.get(member));
          }
        }
      }),
    );
  });
});
