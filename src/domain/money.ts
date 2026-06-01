/**
 * Money primitives for the Ledger Service core (task 2.2, INV-4).
 *
 * This module owns the two things the rest of the domain relies on to keep
 * money exact: **ISO-4217 currency validation** (with per-currency minor-digit
 * metadata) and **integer-only conversion** between a human-entered major-unit
 * value (e.g. `"12.34"`) and the integer minor-units representation every other
 * layer stores and computes with (Req 12.1–12.4).
 *
 * ## The no-floating-point discipline (Req 12.2)
 *
 * Not a single function here ever multiplies, divides, or rounds a monetary
 * value with floating-point arithmetic — **including zero**. The naive
 * conversion `Math.round(parseFloat(input) * 100)` is exactly what this module
 * exists to avoid: `parseFloat("1.10")` is `1.1000000000000001`, and scaling a
 * binary float by a power of ten reintroduces the rounding error INV-4 forbids.
 *
 * Instead, conversion is performed entirely on **integer strings**:
 *   1. The entered value is split on the decimal separator into an integer part
 *      and a fractional part — two strings of decimal digits.
 *   2. The fractional string is right-padded (or rejected if too long) to the
 *      currency's minor-digit count.
 *   3. The two digit strings are concatenated and parsed once, via `BigInt`, so
 *      the result is an exact integer with no intermediate float.
 *
 * Formatting runs the same machinery in reverse: an integer is rendered to a
 * decimal string by slicing digit strings, never by dividing by `100`.
 *
 * The public surface is pure and dependency-free (only the `Result` model is
 * imported), so it can be property-tested independently of persistence.
 */

import { err, ok, type Result } from "./result";

/**
 * The largest integer a JavaScript `number` can represent exactly,
 * `2^53 − 1` (`Number.MAX_SAFE_INTEGER`). {@link parseMajorToMinor} returns a
 * `number`, so it caps results here; amounts beyond this range only ever exist
 * as `bigint` at the persistence boundary (see `types.ts`).
 */
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * ISO-4217 metadata: the number of minor-unit digits ("exponent") for each
 * supported three-letter currency code.
 *
 * The value is how many decimal places the currency's minor unit occupies:
 *   - `2` — the common case (USD cents, EUR cents, GBP pence, NGN kobo).
 *   - `0` — currencies with no minor unit (JPY yen, KRW won); a fractional
 *     entry like `"100.5"` is therefore invalid for them.
 *   - `3` — currencies whose minor unit is a thousandth (BHD fils, KWD fils).
 *
 * This is a representative set spanning all three minor-digit shapes the money
 * utilities must handle, not the full ISO-4217 list. It is intentionally a
 * `null`-free plain record keyed by uppercase code; {@link isValidCurrency}
 * treats "present in this table" as "valid".
 */
export const CURRENCY_MINOR_DIGITS: Readonly<Record<string, number>> =
  Object.freeze({
    // --- 2-digit minor unit (the common case) ---
    USD: 2, // US dollar (cents)
    EUR: 2, // Euro (cents)
    GBP: 2, // Pound sterling (pence)
    NGN: 2, // Nigerian naira (kobo)
    CAD: 2, // Canadian dollar (cents)
    AUD: 2, // Australian dollar (cents)
    NZD: 2, // New Zealand dollar (cents)
    CHF: 2, // Swiss franc (rappen)
    CNY: 2, // Chinese yuan (fen)
    INR: 2, // Indian rupee (paise)
    ZAR: 2, // South African rand (cents)
    KES: 2, // Kenyan shilling (cents)
    GHS: 2, // Ghanaian cedi (pesewa)
    BRL: 2, // Brazilian real (centavos)
    MXN: 2, // Mexican peso (centavos)
    SEK: 2, // Swedish krona (öre)
    NOK: 2, // Norwegian krone (øre)
    DKK: 2, // Danish krone (øre)
    PLN: 2, // Polish złoty (grosz)
    SGD: 2, // Singapore dollar (cents)
    HKD: 2, // Hong Kong dollar (cents)
    AED: 2, // UAE dirham (fils)
    SAR: 2, // Saudi riyal (halala)

    // --- 0-digit (no minor unit) ---
    JPY: 0, // Japanese yen
    KRW: 0, // South Korean won
    VND: 0, // Vietnamese đồng
    CLP: 0, // Chilean peso
    ISK: 0, // Icelandic króna
    XAF: 0, // Central African CFA franc
    XOF: 0, // West African CFA franc

    // --- 3-digit minor unit (thousandths) ---
    BHD: 3, // Bahraini dinar (fils)
    KWD: 3, // Kuwaiti dinar (fils)
    OMR: 3, // Omani rial (baisa)
    TND: 3, // Tunisian dinar (millimes)
    JOD: 3, // Jordanian dinar (fils)
    IQD: 3, // Iraqi dinar (fils)
  });

/**
 * Whether `code` is a supported, valid ISO-4217 three-letter currency code.
 *
 * Validity is case-sensitive and exact: the code must be one of the uppercase
 * keys in {@link CURRENCY_MINOR_DIGITS}. A lowercase variant (`"usd"`), a
 * wrong-length string, a padded string, or an unassigned triple (`"ZZZ"`) all
 * return `false` (Req 1.5, 1.7, 3.2, 6.3, 8.3).
 *
 * @param code - The candidate currency code.
 * @returns `true` when `code` is a known ISO-4217 code.
 */
export function isValidCurrency(code: string): boolean {
  return (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_DIGITS, code)
  );
}

/**
 * The number of minor-unit digits for a valid currency code, or `undefined`
 * when the code is not a supported ISO-4217 code.
 *
 * @param code - The currency code to look up.
 * @returns The minor-digit count (`0`, `2`, or `3` in the supported set), or
 *          `undefined` for an unknown code.
 */
export function currencyMinorDigits(code: string): number | undefined {
  return isValidCurrency(code) ? CURRENCY_MINOR_DIGITS[code] : undefined;
}

/**
 * Parse a human-entered major-unit value into integer minor units, using
 * integer/string arithmetic only — never floating point (Req 12.2, 12.4).
 *
 * The input is the raw value a member typed, in major units: an optional run of
 * decimal digits, an optional single `.` decimal separator, and an optional
 * fractional run of decimal digits. Surrounding whitespace is ignored. Examples
 * for a 2-digit currency: `"12.34" → 1234`, `"12.3" → 1230`, `"12" → 1200`,
 * `"0" → 0`, `"0.05" → 5`. For a 0-digit currency (JPY) `"1000" → 1000` while
 * `"1000.5"` is rejected (no minor unit). For a 3-digit currency (BHD)
 * `"1.005" → 1005`.
 *
 * Rejected as a `validation` error (the ledger/caller is unaffected):
 *   - an unknown currency code (`field: "currency"`);
 *   - empty/whitespace-only or otherwise malformed input — letters, multiple
 *     decimal points, a bare `"."`, grouping separators (`field: "amount"`);
 *   - a negative value: monetary inputs in LedgerLoop are non-negative
 *     (`field: "amount"`);
 *   - more fractional digits than the currency allows, which would silently
 *     drop precision (`field: "amount"`);
 *   - a result exceeding {@link MAX_SAFE_MINOR}; such magnitudes are handled as
 *     `bigint` at the persistence boundary, not by this `number`-returning
 *     utility (`field: "amount"`).
 *
 * Zero parses to the integer `0` (never `-0`, never a float), satisfying the
 * "including zero" clause of Req 12.2.
 *
 * @param input    - The entered major-unit value, as a string.
 * @param currency - The ISO-4217 code whose minor-digit count governs scaling.
 * @returns `ok(minorUnits)` with a non-negative safe integer, or a `validation`
 *          {@link Result} identifying the offending field.
 */
export function parseMajorToMinor(
  input: string,
  currency: string,
): Result<number> {
  const digits = currencyMinorDigits(currency);
  if (digits === undefined) {
    return err<number>("validation", "Currency is not a valid ISO-4217 code.", {
      field: "currency",
    });
  }

  if (typeof input !== "string") {
    return err<number>("validation", "Amount is required.", {
      field: "amount",
    });
  }

  const trimmed = input.trim();
  if (trimmed === "") {
    return err<number>("validation", "Amount is required.", {
      field: "amount",
    });
  }

  // Give an explicit reason for a signed value before the generic shape check.
  if (trimmed.startsWith("-")) {
    return err<number>("validation", "Amount cannot be negative.", {
      field: "amount",
    });
  }

  // The only accepted shape: integer digits, optionally followed by a single
  // decimal point and fractional digits. No sign, no grouping, no bare ".".
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return err<number>("validation", "Amount is not a valid number.", {
      field: "amount",
    });
  }

  const dotIndex = trimmed.indexOf(".");
  const intPart = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? "" : trimmed.slice(dotIndex + 1);

  if (fracPart.length > digits) {
    return err<number>(
      "validation",
      digits === 0
        ? "This currency has no minor unit; remove the decimal places."
        : `Amount has more than ${String(digits)} decimal place${
            digits === 1 ? "" : "s"
          } for this currency.`,
      { field: "amount" },
    );
  }

  // Combine integer and (right-padded) fractional digit strings, then parse the
  // whole thing once as an exact integer. No float ever participates.
  const paddedFrac = fracPart.padEnd(digits, "0");
  const minorString = intPart + paddedFrac;
  const minorBig = BigInt(minorString);

  if (minorBig > MAX_SAFE_MINOR) {
    return err<number>("validation", "Amount is too large.", {
      field: "amount",
    });
  }

  return ok(Number(minorBig));
}

/**
 * Format an integer minor-units amount into its canonical major/minor decimal
 * presentation for `currency`, without any floating-point arithmetic
 * (Req 12.3).
 *
 * The result is a plain decimal string with exactly the currency's minor-digit
 * count after the separator: `1234 USD → "12.34"`, `5 USD → "0.05"`,
 * `1200 USD → "12.00"`, `1000 JPY → "1000"` (no separator for 0-digit
 * currencies), `1005 BHD → "1.005"`. Negative amounts — which occur for derived
 * debtor net positions — keep their sign: `-1234 USD → "-12.34"`.
 *
 * This is the unadorned numeric form (no currency symbol and no locale grouping
 * separators); the Web UI layer decorates it. It is the exact inverse of
 * {@link parseMajorToMinor} for non-negative inputs, which the money-formatting
 * round-trip property relies on.
 *
 * @param amountMinor - The amount as an integer count of minor units. Must be a
 *                      safe integer.
 * @param currency    - A valid ISO-4217 code.
 * @returns The formatted major/minor decimal string.
 * @throws RangeError if `currency` is not a supported ISO-4217 code.
 * @throws TypeError if `amountMinor` is not a safe integer (a float would
 *         violate INV-4, so it is rejected rather than rendered).
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const digits = currencyMinorDigits(currency);
  if (digits === undefined) {
    throw new RangeError(
      `formatMinor: '${currency}' is not a valid ISO-4217 currency code.`,
    );
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError(
      "formatMinor: amountMinor must be a safe integer in minor units (INV-4).",
    );
  }

  // Work on the magnitude as an exact integer string; reattach the sign last.
  const big = BigInt(amountMinor);
  const negative = big < 0n;
  const absStr = (negative ? -big : big).toString();
  const sign = negative ? "-" : "";

  if (digits === 0) {
    return sign + absStr;
  }

  // Ensure at least one major digit plus `digits` minor digits, then slice.
  const padded = absStr.padStart(digits + 1, "0");
  const major = padded.slice(0, padded.length - digits);
  const minor = padded.slice(padded.length - digits);
  return `${sign}${major}.${minor}`;
}
