/**
 * Property test for rejection of non-reconciling or empty split inputs (task 3.5).
 *
 * Property 3: Non-reconciling or empty split inputs are rejected with no ledger
 * change (design: Testing Strategy).
 *
 * Validates Requirements 7.4, 7.6, 7.7:
 *   - Req 7.4: percent split with percentages NOT summing to 100 is rejected,
 *     no Expense or Expense_Split is recorded, and a validation message is
 *     returned.
 *   - Req 7.6: exact split with shares NOT summing to amountMinor is rejected,
 *     no Expense or Expense_Split is recorded, and a validation message is
 *     returned.
 *   - Req 7.7: empty participant set is rejected, no Expense or Expense_Split
 *     is recorded, and a validation message is returned.
 *
 * The generators produce three rejection cases:
 *   (1) percent with percents NOT summing to 100,
 *   (2) exact with shares NOT summing to amountMinor,
 *   (3) empty participant set (userIds = []).
 *
 * For each, the test asserts:
 *   - The result is not ok (rejected).
 *   - error.category === "validation".
 *   - No splits are returned (the function produced nothing).
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { safeAmountMinorNumber } from "../helpers/generators";
import { percentSplit, exactSplit } from "@/domain";

describe("Split_Calculator — Property 3: Non-reconciling or empty split inputs are rejected", () => {
  // Feature: ledgerloop-app, Property 3: Non-reconciling or empty split inputs are rejected with no ledger change
  it("rejects percent splits where percents do not sum to 100, exact splits where shares do not sum to amountMinor, and empty participant sets", () => {
    assertProperty(
      fc.property(
        safeAmountMinorNumber(),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 2 }),
        (amountMinor, userIds, caseIndex) => {
          if (caseIndex === 0) {
            // Case 1: percent split with percents NOT summing to 100 (Req 7.4).
            // Generate valid-looking percents that sum to 100, then perturb one
            // so the sum is no longer 100.
            const n = userIds.length;
            const percents = Array.from({ length: n }, () => Math.floor(100 / n));
            // Distribute remainder to make them sum to 100 first
            let remaining = 100 - percents.reduce((a, b) => a + b, 0);
            for (let i = 0; remaining > 0; i++) {
              percents[i]! += 1;
              remaining--;
            }
            // Now perturb: add 1 to the first element so sum !== 100
            percents[0] = (percents[0] ?? 0) + 1;

            const result = percentSplit(amountMinor, userIds, percents);

            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("validation");
            }
          } else if (caseIndex === 1) {
            // Case 2: exact split with shares NOT summing to amountMinor (Req 7.6).
            // Generate shares that sum to amountMinor, then add 1 to one share
            // so the sum exceeds amountMinor.
            const n = userIds.length;
            const base = Math.floor(amountMinor / n);
            const shares = Array.from({ length: n }, () => base);
            // Distribute remainder to make them sum to amountMinor first
            let remaining = amountMinor - shares.reduce((a, b) => a + b, 0);
            for (let i = 0; remaining > 0; i++) {
              shares[i]! += 1;
              remaining--;
            }
            // Now perturb: add 1 to the first share so sum !== amountMinor
            shares[0] = (shares[0] ?? 0) + 1;

            const result = exactSplit(amountMinor, userIds, shares);

            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("validation");
            }
          } else {
            // Case 3: empty participant set (Req 7.7).
            // percentSplit and exactSplit with empty userIds should reject.
            const emptyUserIds: string[] = [];

            // percentSplit with empty participants — percents array is also empty
            // but the length mismatch or empty set should trigger validation.
            const percentResult = percentSplit(amountMinor, emptyUserIds, []);
            // The percents sum to 0, not 100, so this is rejected.
            expect(percentResult.ok).toBe(false);
            if (!percentResult.ok) {
              expect(percentResult.error.category).toBe("validation");
            }

            // exactSplit with empty participants — shares array is also empty
            // and sum is 0 !== amountMinor (since amountMinor >= 1).
            const exactResult = exactSplit(amountMinor, emptyUserIds, []);
            expect(exactResult.ok).toBe(false);
            if (!exactResult.ok) {
              expect(exactResult.error.category).toBe("validation");
            }
          }
        },
      ),
    );
  });
});
