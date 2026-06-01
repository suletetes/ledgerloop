/**
 * Property test for the zero-sum invariant (task 4.3).
 *
 * Property 12: Group net positions sum to zero (INV-2) (design: Testing
 * Strategy). Validates Requirements 9.3 and 9.7 — for any group and any valid
 * append-only ledger (expenses + reconciling splits + settlements), including
 * the empty ledger:
 *   (9.3) the integer sum of every member's derived Net_Position equals
 *         exactly zero, and
 *   (9.7) when the group has no expenses and no settlements, every member's
 *         derived Net_Position is zero.
 *
 * INV-2 only holds when each expense's splits reconcile to the expense amount
 * (INV-1). The snapshot generator therefore builds each expense's splits with
 * `equalSplit`, whose shares are guaranteed to sum to the amount, so every
 * generated ledger is a *valid* one. Settlements are between two distinct
 * members for a positive integer amount. Amounts and counts are kept modest so
 * the integer sums stay well within `Number.MAX_SAFE_INTEGER`.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import {
  deriveNetPositions,
  equalSplit,
  type LedgerSnapshot,
  type SnapshotExpense,
  type SnapshotSplit,
  type SnapshotSettlement,
} from "@/domain";

/** Modest per-expense / per-settlement ceiling: sums stay safe-integer exact. */
const MAX_AMOUNT_MINOR = 1_000_000;
/** Modest ledger size so the largest possible sum (rows × ceiling) is tiny. */
const MAX_ROWS = 8;
const MAX_MEMBERS = 6;
const CURRENCIES = ["USD", "EUR", "NGN", "GBP"] as const;

/**
 * A valid append-only {@link LedgerSnapshot}: distinct members, expenses whose
 * `equalSplit` shares reconcile to the amount (INV-1), and settlements between
 * distinct members. Naturally includes the empty ledger (zero expenses and
 * zero settlements) among its generated cases.
 */
function validLedgerSnapshot(): fc.Arbitrary<LedgerSnapshot> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 1, maxLength: MAX_MEMBERS })
    .chain((members) => {
      const member = fc.constantFrom(...members);
      const currency = fc.constantFrom(...CURRENCIES);

      const expenseSpecs = fc.array(
        fc.record({
          paidBy: member,
          amountMinor: fc.integer({ min: 1, max: MAX_AMOUNT_MINOR }),
          participants: fc.uniqueArray(member, {
            minLength: 1,
            maxLength: members.length,
          }),
          currency,
        }),
        { maxLength: MAX_ROWS },
      );

      // Settlements need two distinct members; with a single member there are
      // none to record.
      const settlements: fc.Arbitrary<SnapshotSettlement[]> =
        members.length >= 2
          ? fc.array(
              fc
                .tuple(
                  member,
                  member,
                  fc.integer({ min: 1, max: MAX_AMOUNT_MINOR }),
                  currency,
                )
                .filter(([fromUser, toUser]) => fromUser !== toUser)
                .map(([fromUser, toUser, amountMinor, cur]) => ({
                  fromUser,
                  toUser,
                  amountMinor,
                  currency: cur,
                })),
              { maxLength: MAX_ROWS },
            )
          : fc.constant<SnapshotSettlement[]>([]);

      return fc.tuple(expenseSpecs, settlements).map(([specs, settles]) => {
        const expenses: SnapshotExpense[] = [];
        const splits: SnapshotSplit[] = [];
        specs.forEach((spec, index) => {
          const id = `expense-${index}`;
          expenses.push({
            id,
            paidBy: spec.paidBy,
            amountMinor: spec.amountMinor,
            currency: spec.currency,
          });
          // equalSplit shares sum exactly to amountMinor (INV-1), so this
          // expense nets to zero across its participants.
          for (const share of equalSplit(spec.amountMinor, spec.participants)) {
            splits.push({
              expenseId: id,
              userId: share.userId,
              shareMinor: share.shareMinor,
            });
          }
        });
        return { members, expenses, splits, settlements: settles };
      });
    });
}

describe("Balance_Engine.deriveNetPositions — Property 12", () => {
  // Feature: ledgerloop-app, Property 12: Group net positions sum to zero (INV-2)
  it("derives net positions that sum to exactly zero, and zero per member for an empty ledger", () => {
    assertProperty(
      fc.property(validLedgerSnapshot(), (snapshot) => {
        const net = deriveNetPositions(snapshot);
        const values = [...net.values()];

        // Each net position is an integer in minor units (INV-4 discipline).
        for (const value of values) {
          expect(Number.isInteger(value)).toBe(true);
        }

        // (9.3, INV-2) The integer sum of all members' net positions is
        // exactly zero, for any valid ledger.
        const sum = values.reduce((acc, value) => acc + value, 0);
        expect(sum).toBe(0);

        // (9.7) With no expenses and no settlements, every member derives zero.
        if (snapshot.expenses.length === 0 && snapshot.settlements.length === 0) {
          for (const memberId of snapshot.members) {
            expect(net.get(memberId)).toBe(0);
          }
        }
      }),
      {
        // Guarantee the empty-ledger case (Req 9.7) is always exercised.
        examples: [
          [
            {
              members: ["member-a", "member-b", "member-c"],
              expenses: [],
              splits: [],
              settlements: [],
            },
          ],
        ],
      },
    );
  });
});
