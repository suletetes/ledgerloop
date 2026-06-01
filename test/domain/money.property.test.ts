/**
 * Property-based test for INV-4 money representation (task 2.3).
 *
 * Property 20 (design Testing Strategy): "For any operation in the system,
 * every stored or computed monetary value — including zero — is an integer in
 * minor units and is never represented as a floating-point number."
 *
 * The pure money utilities (`src/domain/money.ts`) are the only place the rest
 * of the domain turns a human-entered major-unit value into the integer
 * minor-units representation every other layer stores and computes with, and
 * back again for display. This test locks down the integer-ness half of that
 * contract (Req 12.1, 12.2): whatever a well-formed amount is entered as, the
 * parsed value is a non-negative safe integer (never a float, never `-0`), and
 * any value that exists as integer minor units survives a format → re-parse
 * trip unchanged and as an integer. Zero is exercised explicitly because
 * Req 12.2 calls it out by name.
 */
import { describe, it, expect } from "vitest";
import { assertProperty, fc } from "../helpers/property";
import { iso4217Code, ISO_4217_CODES } from "../helpers/generators";
import {
  parseMajorToMinor,
  formatMinor,
  currencyMinorDigits,
} from "@/domain";

const DIGIT_CHARS = "0123456789".split("");

/**
 * A well-formed entered major-unit string for a currency with `minorDigits`
 * minor digits: an integer run of decimal digits, optionally followed by a
 * decimal point and up to `minorDigits` fractional digits (a 0-digit currency
 * such as JPY accepts no fractional part). The integer magnitude is bounded so
 * the resulting minor-units value stays a safe integer.
 */
function wellFormedMajorString(minorDigits: number): fc.Arbitrary<string> {
  const intPart = fc.integer({ min: 0, max: 9_999_999_999 }).map(String);
  if (minorDigits === 0) {
    return intPart;
  }
  const frac = fc
    .array(fc.constantFrom(...DIGIT_CHARS), {
      minLength: 0,
      maxLength: minorDigits,
    })
    .map((chars) => chars.join(""));
  return fc
    .tuple(intPart, frac)
    .map(([i, f]) => (f.length > 0 ? `${i}.${f}` : i));
}

/**
 * A valid currency paired with both a well-formed entered major-unit value and
 * an independently generated integer minor-units amount, so a single property
 * can check parsing AND the format → re-parse round trip for the same currency.
 */
const moneyScenario = iso4217Code().chain((currency) => {
  const minorDigits = currencyMinorDigits(currency) ?? 0;
  return fc.record({
    currency: fc.constant(currency),
    enteredMajor: wellFormedMajorString(minorDigits),
    minorUnits: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  });
});

describe("Property 20: monetary values are integer minor units (INV-4)", () => {
  // Feature: ledgerloop-app, Property 20: All monetary values are integer minor units (INV-4)
  // Validates: Requirements 12.1, 12.2
  it("parses entered amounts to integer minor units and round-trips integers, never floats", () => {
    assertProperty(
      fc.property(moneyScenario, ({ currency, enteredMajor, minorUnits }) => {
        // (1) A well-formed entered major-unit value parses to a non-negative
        // safe integer — never a float, never -0 (Req 12.1, 12.2).
        const parsed = parseMajorToMinor(enteredMajor, currency);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(typeof parsed.value).toBe("number");
          expect(Number.isInteger(parsed.value)).toBe(true);
          expect(Number.isSafeInteger(parsed.value)).toBe(true);
          expect(parsed.value).toBeGreaterThanOrEqual(0);
          expect(Object.is(parsed.value, -0)).toBe(false);
        }

        // (2) A value held as integer minor units formats to a string and
        // re-parses to the very same integer — the representation never decays
        // into a floating-point number (Req 12.2).
        const formatted = formatMinor(minorUnits, currency);
        expect(typeof formatted).toBe("string");

        const reparsed = parseMajorToMinor(formatted, currency);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) {
          expect(Number.isInteger(reparsed.value)).toBe(true);
          expect(reparsed.value).toBe(minorUnits);
        }
      }),
    );
  });

  it("represents zero as the integer 0 — never a float — including '0' and '0.00' (Req 12.2)", () => {
    for (const currency of ISO_4217_CODES) {
      const digits = currencyMinorDigits(currency) ?? 0;
      const zeroInputs =
        digits === 0 ? ["0"] : ["0", `0.${"0".repeat(digits)}`];

      for (const input of zeroInputs) {
        const parsed = parseMajorToMinor(input, currency);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value).toBe(0);
          expect(Number.isInteger(parsed.value)).toBe(true);
          expect(Object.is(parsed.value, -0)).toBe(false);
        }
      }

      // Formatting zero minor units is equally integer-faithful.
      const reparsedZero = parseMajorToMinor(formatMinor(0, currency), currency);
      expect(reparsedZero.ok).toBe(true);
      if (reparsedZero.ok) {
        expect(reparsedZero.value).toBe(0);
      }
    }
  });
});
