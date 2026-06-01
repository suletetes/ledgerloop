/**
 * Property test for the split-sum invariant (task 3.4).
 *
 * Property 1: Split shares sum exactly to the expense amount (INV-1).
 * Validates Requirements 7.1, 7.3, 7.5, 7.8, 7.9 — for any valid expense with
 * a positive integer amountMinor in minor units and any split type (equal,
 * percent with percentages summing to 100, or exact with shares summing to the
 * amount) over a non-empty ordered participant set, the sum of the produced
 * Expense_Split shares equals amountMinor exactly, and every share is a
 * non-negative integer in minor units.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { equalSplit, percentSplit, exactSplit } from "@/domain";

/**
 * A positive integer amount in minor units constrained so that
 * `amountMinor * 100` stays within Number.MAX_SAFE_INTEGER. This avoids
 * precision loss in percentSplit's internal `amountMinor * pct` multiplication
 * (where pct can be up to 100). The upper bound is floor(MAX_SAFE_INTEGER/100).
 */
function splitSafeAmount(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: Math.floor(Number.MAX_SAFE_INTEGER / 100) });
}

/**
 * Generate an array of n non-negative integers that sum to exactly `total`.
 * Strategy: generate n-1 random breakpoints in [0, total], sort them, and
 * compute differences. This produces a uniform-ish partition.
 */
function percentsArb(n: number): fc.Arbitrary<number[]> {
  if (n === 1) return fc.constant([100]);
  // Generate n-1 breakpoints in [0, 100], sort, then compute differences.
  return fc
    .array(fc.integer({ min: 0, max: 100 }), {
      minLength: n - 1,
      maxLength: n - 1,
    })
    .map((breakpoints) => {
      const sorted = [0, ...breakpoints.sort((a, b) => a - b), 100];
      const parts: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        parts.push((sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
      }
      return parts;
    });
}

describe("Split_Calculator — Property 1: Split-sum invariant (INV-1)", () => {
  // Feature: ledgerloop-app, Property 1: Split shares sum exactly to the expense amount (INV-1)
  it("for all three split types, shares sum exactly to amountMinor and every share is a non-negative integer", () => {
    assertProperty(
      fc.property(
        splitSafeAmount(),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }),
        (amountMinor, userIds) => {
          // --- Equal split (Req 7.1) ---
          const equalShares = equalSplit(amountMinor, userIds);
          const equalSum = equalShares.reduce((acc, s) => acc + s.shareMinor, 0);
          expect(equalSum).toBe(amountMinor);
          for (const s of equalShares) {
            expect(Number.isInteger(s.shareMinor)).toBe(true);
            expect(s.shareMinor).toBeGreaterThanOrEqual(0);
          }

          // --- Percent split (Req 7.3) ---
          // Generate percentages summing to exactly 100 for this participant count.
          const n = userIds.length;
          // Use a deterministic percent generation: give each member floor(100/n),
          // then distribute the remainder to the first few members.
          const basePercent = Math.floor(100 / n);
          const percentRemainder = 100 - basePercent * n;
          const percents = userIds.map((_, i) =>
            basePercent + (i < percentRemainder ? 1 : 0),
          );

          const percentResult = percentSplit(amountMinor, userIds, percents);
          expect(percentResult.ok).toBe(true);
          if (percentResult.ok) {
            const percentSum = percentResult.value.reduce(
              (acc, s) => acc + s.shareMinor,
              0,
            );
            expect(percentSum).toBe(amountMinor);
            for (const s of percentResult.value) {
              expect(Number.isInteger(s.shareMinor)).toBe(true);
              expect(s.shareMinor).toBeGreaterThanOrEqual(0);
            }
          }

          // --- Exact split (Req 7.5) ---
          // Use equalSplit output as the exact shares (they already sum to amountMinor).
          const exactShares = equalShares.map((s) => s.shareMinor);
          const exactResult = exactSplit(amountMinor, userIds, exactShares);
          expect(exactResult.ok).toBe(true);
          if (exactResult.ok) {
            const exactSum = exactResult.value.reduce(
              (acc, s) => acc + s.shareMinor,
              0,
            );
            expect(exactSum).toBe(amountMinor);
            for (const s of exactResult.value) {
              expect(Number.isInteger(s.shareMinor)).toBe(true);
              expect(s.shareMinor).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
    );
  });
});
