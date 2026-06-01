/**
 * Property-based test for Currency_Display conversion (task 7.2).
 *
 * Validates that display conversion preserves stored data and the original,
 * never mutates inputs, and is consistent with the cached FX rate.
 */
import { describe, it } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code } from "../helpers/generators";
import { convert } from "@/domain/currency-display";
import type { FxRate, FxRateCache } from "@/domain/currency-display";

// Feature: ledgerloop-app, Property 22: Display conversion preserves stored data and the original
describe("Currency_Display — Property 22: Display conversion preserves stored data and the original", () => {
  it("cross-currency conversion preserves original and is consistent with cached rate, and same-currency is identity, and missing rate signals unavailable", () => {
    assertProperty(
      fc.property(
        // amountMinor: positive integer in safe range
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        // fromCurrency
        iso4217Code(),
        // toCurrency (different from fromCurrency for cross-currency case)
        iso4217Code(),
        // ratePpm: positive integer (1..10_000_000_000)
        fc.integer({ min: 1, max: 10_000_000_000 }),
        (amountMinor, fromCurrency, toCurrency, ratePpm) => {
          // --- Case 1: Cross-currency with a cached rate ---
          if (fromCurrency !== toCurrency) {
            const rate: FxRate = {
              from: fromCurrency,
              to: toCurrency,
              ratePpm,
              asOf: "2024-01-01T00:00:00Z",
            };
            const cache: FxRateCache = new Map([
              [`${fromCurrency}:${toCurrency}`, rate],
            ]);

            // Save original value to verify no mutation (Req 14.5)
            const originalAmountMinor = amountMinor;

            const result = convert(amountMinor, fromCurrency, toCurrency, cache);

            // (1) result.converted === true
            if (!result.converted) {
              return false;
            }

            // (2) Original preserved (Req 14.3)
            if (
              result.original.amountMinor !== amountMinor ||
              result.original.currency !== fromCurrency
            ) {
              return false;
            }

            // (3) Converted amount consistent with cached rate (Req 14.2)
            const expected = Math.round(amountMinor * ratePpm / 1_000_000);
            if (result.amountMinor !== expected) {
              return false;
            }

            // (4) Original amountMinor variable unchanged (Req 14.5)
            if (amountMinor !== originalAmountMinor) {
              return false;
            }
          }

          // --- Case 2: Same-currency is identity ---
          {
            const emptyCache: FxRateCache = new Map();
            const result = convert(amountMinor, fromCurrency, fromCurrency, emptyCache);

            // Same-currency always succeeds
            if (!result.converted) {
              return false;
            }

            // Converted amount === original amount (identity)
            if (result.amountMinor !== amountMinor) {
              return false;
            }

            // Original preserved
            if (
              result.original.amountMinor !== amountMinor ||
              result.original.currency !== fromCurrency
            ) {
              return false;
            }
          }

          // --- Case 3: Missing rate signals conversion unavailable ---
          if (fromCurrency !== toCurrency) {
            const emptyCache: FxRateCache = new Map();
            const result = convert(amountMinor, fromCurrency, toCurrency, emptyCache);

            // converted === false
            if (result.converted !== false) {
              return false;
            }

            // Original preserved
            if (
              result.original.amountMinor !== amountMinor ||
              result.original.currency !== fromCurrency
            ) {
              return false;
            }
          }

          return true;
        },
      ),
    );
  });
});
