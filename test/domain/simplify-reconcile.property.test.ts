/**
 * Property test for Debt_Simplifier plan reconciliation (task 5.2).
 *
 * Property 16: Simplified plan reconciles to net positions (design: Testing
 * Strategy). Validates Requirements 10.1, 10.2, 10.7 — for any map of net
 * positions that sums to zero, {@link simplifyDebts} produces a plan in which,
 * for every member, the sum of transfers received minus the sum of transfers
 * sent equals that member's net position, and every transfer is a positive
 * integer minor-units amount from a payer to a distinct receiver.
 *
 * The generator builds a ZERO-SUM net map (INV-2, the well-formed group shape
 * the simplifier reconciles exactly): it draws `k` distinct member ids and
 * `k - 1` arbitrary integer net values of modest magnitude (negative debtors,
 * positive creditors, or zero), then sets the final member's net position to
 * the negation of the running sum so the whole map sums to exactly zero.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { simplifyDebts } from "@/domain";

/**
 * A `Map<string, number>` of per-member net positions whose values sum to
 * exactly zero, over `1..10` distinct member ids (positive = creditor,
 * negative = debtor, zero = settled).
 */
function zeroSumNetPositions(): fc.Arbitrary<Map<string, number>> {
  return fc
    .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 })
    .chain((ids) => {
      const head = ids.slice(0, ids.length - 1);
      const last = ids[ids.length - 1];
      return fc
        .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: head.length,
          maxLength: head.length,
        })
        .map((values) => {
          const net = new Map<string, number>();
          let sum = 0;
          head.forEach((id, i) => {
            const value = values[i] ?? 0;
            net.set(id, value);
            sum += value;
          });
          // The last member absorbs the negation of the running sum so the map
          // sums to exactly zero (avoid -0 so positions read back cleanly).
          if (last !== undefined) {
            net.set(last, sum === 0 ? 0 : -sum);
          }
          return net;
        });
    });
}

describe("Debt_Simplifier.simplifyDebts — Property 16", () => {
  // Feature: ledgerloop-app, Property 16: Simplified plan reconciles to net positions
  it("produces positive-integer transfers between distinct members that reconcile to every member's net position", () => {
    assertProperty(
      fc.property(zeroSumNetPositions(), (net) => {
        const plan = simplifyDebts(net);

        // (1) Every transfer is a positive integer in minor units, and (2) it
        // moves money from a payer to a DISTINCT receiver (Req 10.7).
        for (const transfer of plan) {
          expect(Number.isInteger(transfer.amountMinor)).toBe(true);
          expect(transfer.amountMinor).toBeGreaterThan(0);
          expect(transfer.from).not.toBe(transfer.to);
        }

        // (3) For every member, (received − sent) across the plan equals that
        // member's net position (Req 10.1, 10.2).
        const received = new Map<string, number>();
        const sent = new Map<string, number>();
        for (const transfer of plan) {
          received.set(
            transfer.to,
            (received.get(transfer.to) ?? 0) + transfer.amountMinor,
          );
          sent.set(
            transfer.from,
            (sent.get(transfer.from) ?? 0) + transfer.amountMinor,
          );
        }

        for (const [member, position] of net) {
          const netFlow =
            (received.get(member) ?? 0) - (sent.get(member) ?? 0);
          expect(netFlow).toBe(position);
        }
      }),
    );
  });
});
