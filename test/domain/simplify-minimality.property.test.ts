/**
 * Property test for Debt_Simplifier plan minimality (task 5.3).
 *
 * Property 17: Simplified plan is minimal and empty when settled
 * (design: Testing Strategy). Validates:
 *   - Requirement 10.3 — the Simplified_Plan contains at most one fewer
 *     transfer than the number of members holding a non-zero Net_Position.
 *   - Requirement 10.4 — while every member holds a zero Net_Position, the
 *     plan is empty.
 *
 * The generator builds a ZERO-SUM net map (INV-2): for `k` distinct members it
 * draws `k − 1` arbitrary modest integers and sets the last member to the
 * negation of their sum, so the values sum to exactly zero and the
 * simplification is well-formed. `nonZero` is the count of members with a
 * non-zero net; the greedy min-cashflow algorithm zeroes at least one party per
 * transfer, so the plan never exceeds `max(0, nonZero − 1)` transfers (Req
 * 10.3). The all-zero case (Req 10.4) is checked deterministically on an
 * all-zero map built from the same generated members.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { simplifyDebts } from "@/domain";

/**
 * A zero-sum net map over distinct member ids: `k − 1` arbitrary modest
 * integers plus a final balancing entry equal to the negation of their sum, so
 * `Σ values === 0` for any drawn shape (including a lone member, whose only
 * legal zero-sum value is 0).
 */
function zeroSumNetMap(): fc.Arbitrary<Map<string, number>> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 })
    .chain((ids) =>
      fc
        .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: ids.length - 1,
          maxLength: ids.length - 1,
        })
        .map((heads) => {
          const sum = heads.reduce((acc, v) => acc + v, 0);
          const values = [...heads, -sum];
          const net = new Map<string, number>();
          ids.forEach((id, i) => net.set(id, values[i] as number));
          return net;
        }),
    );
}

describe("Debt_Simplifier.simplifyDebts — Property 17", () => {
  // Feature: ledgerloop-app, Property 17: Simplified plan is minimal and empty when settled
  it("produces at most (non-zero members − 1) transfers and an empty plan when all nets are zero", () => {
    assertProperty(
      fc.property(zeroSumNetMap(), (net) => {
        const transfers = simplifyDebts(net);

        // Req 10.3 — at most one fewer transfer than the count of members
        // holding a non-zero net position. With no non-zero members the bound
        // is zero (no transfers possible).
        const nonZero = [...net.values()].filter((v) => v !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

        // Req 10.4 — an all-zero net map (every member settled) yields an empty
        // plan. Built from the same generated members so the count varies.
        const allZero = new Map<string, number>(
          [...net.keys()].map((id) => [id, 0]),
        );
        expect(simplifyDebts(allZero)).toEqual([]);
      }),
    );
  });
});
