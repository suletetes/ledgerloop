/**
 * Property test for net-position derivation (task 4.2).
 *
 * Property 11: Net positions equal an independent ledger recomputation
 * (design: Testing Strategy — model-based). Validates Requirements 9.1 and 9.2:
 * the Balance_Engine derives each member's net position purely from the
 * append-only ledger (never a stored balance), and that derived value equals an
 * INDEPENDENT reference summation of
 *
 *     +paid  −owed  +settled_out  −settled_in
 *
 * over the same ledger. The reference below is written from scratch (it does
 * NOT call any production code) so the test pins the derivation arithmetic
 * against a second, independent implementation rather than against itself.
 *
 * Scope note: this property exercises the derivation ARITHMETIC, so the
 * generated split shares are arbitrary non-negative integers and need not sum
 * to their expense amount (INV-1 is covered by the Split_Calculator and
 * zero-sum properties, not here). Generated magnitudes are kept modest
 * (amounts/shares ≤ 1e9, few rows) so every per-member aggregate stays well
 * within `Number.MAX_SAFE_INTEGER`.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code } from "../helpers/generators";
import { deriveNetPositions } from "@/domain";
import type { LedgerSnapshot } from "@/domain";

/** Modest per-row cap so aggregate sums stay safe-integer exact (INV-4). */
const MAX_ROW_MINOR = 1_000_000_000;

/**
 * An independently-written reference derivation of every member's net position
 * in minor units. Deliberately re-implements the corrected sign convention
 * (`+paid − owed + settled_out − settled_in`) without consulting the production
 * `deriveNetPositions`, so agreement between the two is meaningful.
 *
 * Every listed member is seeded to zero so members with no ledger activity
 * still appear with a derived zero (Req 9.7), mirroring the contract under test
 * without sharing its code.
 */
function referenceNetPositions(snapshot: LedgerSnapshot): Map<string, number> {
  const net = new Map<string, number>();
  for (const memberId of snapshot.members) {
    net.set(memberId, 0);
  }

  const bump = (id: string, delta: number): void => {
    net.set(id, (net.get(id) ?? 0) + delta);
  };

  for (const expense of snapshot.expenses) {
    bump(expense.paidBy, expense.amountMinor); // +paid
  }
  for (const split of snapshot.splits) {
    bump(split.userId, -split.shareMinor); // −owed
  }
  for (const settlement of snapshot.settlements) {
    bump(settlement.fromUser, settlement.amountMinor); // +settled_out
    bump(settlement.toUser, -settlement.amountMinor); // −settled_in
  }

  return net;
}

/**
 * A valid append-only `LedgerSnapshot`: a non-empty set of distinct member ids,
 * expenses paid by a member with arbitrary splits among members, and
 * settlements between DISTINCT members. Counts and magnitudes are bounded so
 * every aggregate sum is representable as a safe integer.
 */
function ledgerSnapshot(): fc.Arbitrary<LedgerSnapshot> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 })
    .chain((members) => {
      const memberArb = fc.constantFrom(...members);
      const amountArb = fc.integer({ min: 1, max: MAX_ROW_MINOR });
      const shareArb = fc.integer({ min: 0, max: MAX_ROW_MINOR });

      const expensesArb = fc.array(
        fc.record({
          id: fc.uuid(),
          paidBy: memberArb,
          amountMinor: amountArb,
          currency: iso4217Code(),
        }),
        { maxLength: 12 },
      );

      return expensesArb.chain((expenses) => {
        // Splits reference a real expense when one exists; the derivation keys
        // off `userId`/`shareMinor` only, so an arbitrary id is harmless when
        // there are no expenses.
        const expenseIdArb =
          expenses.length > 0
            ? fc.constantFrom(...expenses.map((e) => e.id))
            : fc.uuid();

        const splitsArb = fc.array(
          fc.record({
            expenseId: expenseIdArb,
            userId: memberArb,
            shareMinor: shareArb,
          }),
          { maxLength: 18 },
        );

        // A settlement needs two distinct members; with a single member there
        // can be none. `offset ∈ [1, n−1]` guarantees `from !== to`.
        const settlementArb =
          members.length < 2
            ? fc.constant<LedgerSnapshot["settlements"][number]>(
                undefined as never,
              )
            : fc
                .record({
                  fromIndex: fc.integer({ min: 0, max: members.length - 1 }),
                  offset: fc.integer({ min: 1, max: members.length - 1 }),
                  amountMinor: amountArb,
                  currency: iso4217Code(),
                })
                .map(({ fromIndex, offset, amountMinor, currency }) => ({
                  fromUser: members[fromIndex]!,
                  toUser: members[(fromIndex + offset) % members.length]!,
                  amountMinor,
                  currency,
                }));

        const settlementsArb =
          members.length < 2
            ? fc.constant([] as LedgerSnapshot["settlements"])
            : fc.array(settlementArb, { maxLength: 12 });

        return splitsArb.chain((splits) =>
          settlementsArb.map((settlements) => ({
            members,
            expenses,
            splits,
            settlements,
          })),
        );
      });
    });
}

describe("Balance_Engine.deriveNetPositions — Property 11", () => {
  // Feature: ledgerloop-app, Property 11: Net positions equal an independent ledger recomputation
  it("derives each member's net position equal to an independent +paid −owed +settled_out −settled_in recomputation", () => {
    assertProperty(
      fc.property(ledgerSnapshot(), (snapshot) => {
        const derived = deriveNetPositions(snapshot);
        const reference = referenceNetPositions(snapshot);

        // Same member set on both sides: every member appears exactly once,
        // including those with no activity (derived zero, Req 9.7).
        expect(new Set(derived.keys())).toEqual(new Set(snapshot.members));
        expect(derived.size).toBe(reference.size);

        // The derivation equals the independent recomputation for every member.
        for (const memberId of snapshot.members) {
          expect(derived.get(memberId)).toBe(reference.get(memberId));
        }
      }),
    );
  });
});
