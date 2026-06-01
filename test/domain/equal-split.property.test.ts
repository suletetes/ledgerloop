/**
 * Property test for the equal split (task 3.2).
 *
 * Property 2: Equal-split fairness and determinism (design: Testing Strategy).
 * Validates Requirement 7.2 — for an `equal` split that does not divide evenly,
 * the Split_Calculator distributes the remaining minor units so that:
 *   (a) the shares sum to the expense amount exactly,
 *   (b) no two members' shares differ by more than one minor unit, and
 *   (c) identical ordered inputs always yield identical per-member shares.
 * Each share is also a non-negative integer in minor units (Req 7.8).
 *
 * The generators draw a positive integer `amountMinor` within JavaScript's safe
 * integer range and a non-empty list of DISTINCT member ids, mirroring the
 * ordered, non-empty sharing set `equalSplit` is contracted to receive.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { safeAmountMinorNumber } from "../helpers/generators";
import { equalSplit } from "@/domain";

describe("Split_Calculator.equalSplit — Property 2", () => {
  // Feature: ledgerloop-app, Property 2: Equal-split fairness and determinism
  it("is fair (sum-exact, ≤1 minor-unit spread) and deterministic across identical ordered inputs", () => {
    assertProperty(
      fc.property(
        safeAmountMinorNumber(),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 12 }),
        (amountMinor, userIds) => {
          const shares = equalSplit(amountMinor, userIds);
          const shareValues = shares.map((s) => s.shareMinor);

          // All shares are non-negative integers in minor units (Req 7.8).
          for (const value of shareValues) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }

          // (a) The shares sum to the expense amount exactly (Req 7.2, INV-1).
          const total = shareValues.reduce((acc, value) => acc + value, 0);
          expect(total).toBe(amountMinor);

          // (b) No two shares differ by more than one minor unit (Req 7.2).
          expect(Math.max(...shareValues) - Math.min(...shareValues)).toBeLessThanOrEqual(1);

          // (c) Identical ordered inputs yield identical per-member shares
          //     (Req 7.2 determinism).
          const repeat = equalSplit(amountMinor, userIds);
          expect(repeat).toEqual(shares);
        },
      ),
    );
  });
});
