/**
 * Property 21 — Money formatting round-trips (task 2.4, Req 12.3, 12.4).
 *
 * The display path (`formatMinor`) and the input path (`parseMajorToMinor`) must
 * be exact inverses for every non-negative integer minor-units amount and every
 * supported currency: formatting produces a presentation with the currency's
 * correct number of minor digits (Req 12.3), and parsing that presentation back
 * recovers the very same integer minor-units amount (Req 12.4). All of this runs
 * on integer/string arithmetic only — no floating point ever participates
 * (INV-4), which is what makes the round-trip lossless including for zero.
 *
 * This file is intentionally separate from the Property 20 test (task 2.3) even
 * though both exercise `src/domain/money.ts`, so the two property tasks do not
 * collide on a single file.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code, safeAmountMinorNumber } from "../helpers/generators";
import { formatMinor, parseMajorToMinor, currencyMinorDigits } from "@/domain";

describe("Property 21: Money formatting round-trips", () => {
  // Feature: ledgerloop-app, Property 21: Money formatting round-trips
  it("formats with the currency's minor digits and parses back to the same minor units", () => {
    // Amounts: the safe-integer minor-units generator (1..MAX_SAFE_INTEGER)
    // plus an explicit 0 so the "including zero" clause of Req 12.2 is covered
    // on the round-trip path too.
    const nonNegativeSafeMinor = fc.oneof(
      fc.constant(0),
      safeAmountMinorNumber(),
    );

    assertProperty(
      fc.property(nonNegativeSafeMinor, iso4217Code(), (amount, currency) => {
        const digits = currencyMinorDigits(currency);
        // iso4217Code() only yields supported codes, so this is always defined.
        expect(digits).toBeDefined();
        if (digits === undefined) return; // unreachable; narrows the type

        const formatted = formatMinor(amount, currency);

        // (Req 12.3) The presentation carries exactly the right number of
        // fractional digits for the currency — none for 0-digit currencies.
        if (digits === 0) {
          expect(formatted).not.toContain(".");
        } else {
          const dotIndex = formatted.indexOf(".");
          expect(dotIndex).toBeGreaterThanOrEqual(0);
          // Exactly one decimal separator.
          expect(formatted.lastIndexOf(".")).toBe(dotIndex);
          // Exactly `digits` fractional digits after it.
          expect(formatted.slice(dotIndex + 1)).toHaveLength(digits);
        }

        // (Req 12.4) Parsing the formatted major-unit value recovers the exact
        // same integer minor-units amount — a clean, lossless round-trip.
        const parsed = parseMajorToMinor(formatted, currency);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value).toBe(amount);
        }
      }),
    );
  });
});
