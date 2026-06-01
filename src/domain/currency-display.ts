/**
 * Currency_Display — read-time FX conversion for multi-currency display (task 7.1).
 *
 * This module converts stored amounts to a viewer's preferred currency at read
 * time, never mutating stored data (Req 14.1, 14.5). It uses integer-friendly
 * arithmetic via `ratePpm` (parts-per-million) so that the conversion formula
 * `Math.round(amountMinor * ratePpm / 1_000_000)` stays within safe integer
 * territory for typical expense amounts and produces an integer result.
 *
 * **This is a display approximation.** The stored expense/split/settlement
 * amounts are never altered. The original currency and amount are always
 * preserved alongside any converted value (Req 14.3).
 *
 * ## Integer arithmetic discipline
 *
 * `ratePpm` is an integer representing the exchange rate scaled by 1,000,000.
 * For example, if 1 USD = 1500 NGN, then `ratePpm = 1_500_000_000`
 * (1500 × 1,000,000). The conversion formula:
 *
 *   convertedMinor = Math.round(amountMinor * ratePpm / 1_000_000)
 *
 * produces an integer result. This is a display-only approximation; the stored
 * amount is never modified.
 */

// ---------------------------------------------------------------------------
// FxRate model
// ---------------------------------------------------------------------------

/**
 * A cached foreign-exchange rate entry.
 *
 * - `from` / `to`: ISO-4217 three-letter currency codes (uppercase).
 * - `ratePpm`: the exchange rate in parts-per-million (integer). To convert
 *   1 unit of `from` to `to`, multiply by `ratePpm / 1_000_000`.
 *   Example: 1 USD = 1500 NGN → ratePpm = 1_500_000_000.
 * - `asOf`: ISO-8601 date string indicating when the rate was observed.
 */
export interface FxRate {
  readonly from: string;
  readonly to: string;
  readonly ratePpm: number;
  readonly asOf: string;
}

// ---------------------------------------------------------------------------
// FxRateCache
// ---------------------------------------------------------------------------

/**
 * A cache of FX rates keyed by `"FROM:TO"` (e.g. `"USD:NGN"`).
 *
 * The cache is a simple Map; the lookup function handles the key format.
 */
export type FxRateCache = Map<string, FxRate>;

/**
 * Build the cache key for a currency pair.
 */
function cacheKey(from: string, to: string): string {
  return `${from}:${to}`;
}

/**
 * Look up an FX rate in the cache for the given currency pair.
 *
 * @returns The cached `FxRate`, or `undefined` if no rate is available.
 */
export function lookupRate(
  cache: FxRateCache,
  from: string,
  to: string,
): FxRate | undefined {
  return cache.get(cacheKey(from, to));
}

// ---------------------------------------------------------------------------
// Conversion result types
// ---------------------------------------------------------------------------

/** Successful conversion result. */
export interface ConvertedResult {
  readonly converted: true;
  readonly amountMinor: number;
  readonly rate: FxRate;
  readonly original: { readonly amountMinor: number; readonly currency: string };
}

/** Conversion unavailable (no rate in cache). */
export interface NotConvertedResult {
  readonly converted: false;
  readonly original: { readonly amountMinor: number; readonly currency: string };
}

export type ConvertResult = ConvertedResult | NotConvertedResult;

// ---------------------------------------------------------------------------
// convert function
// ---------------------------------------------------------------------------

/**
 * The identity rate used for same-currency "conversion" (rate = 1, i.e.
 * 1_000_000 ppm). This is always available without a cache lookup.
 */
const IDENTITY_RATE_PPM = 1_000_000;

/**
 * Convert a stored amount to a target currency for display purposes.
 *
 * - **Same-currency** (`fromCurrency === toCurrency`): returns the amount
 *   unchanged with an identity rate (ratePpm = 1_000_000). Always succeeds
 *   without consulting the cache.
 * - **Cross-currency with a cached rate**: returns the converted amount
 *   (integer, via `Math.round(amountMinor * ratePpm / 1_000_000)`) plus the
 *   original currency and amount.
 * - **Cross-currency without a cached rate**: signals conversion unavailable
 *   and returns only the original.
 *
 * **Never mutates stored amounts** (Req 14.5). The conversion is a display
 * approximation only.
 *
 * @param amountMinor  - The stored amount in minor units (integer).
 * @param fromCurrency - The currency the amount is stored in (ISO-4217).
 * @param toCurrency   - The viewer's preferred display currency (ISO-4217).
 * @param cache        - The FX rate cache to look up cross-currency rates.
 * @returns A `ConvertResult` indicating success or unavailability.
 */
export function convert(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  cache: FxRateCache,
): ConvertResult {
  const original = { amountMinor, currency: fromCurrency } as const;

  // Same-currency: identity conversion, always available (Req 14.2).
  if (fromCurrency === toCurrency) {
    const identityRate: FxRate = {
      from: fromCurrency,
      to: toCurrency,
      ratePpm: IDENTITY_RATE_PPM,
      asOf: new Date().toISOString(),
    };
    return {
      converted: true,
      amountMinor,
      rate: identityRate,
      original,
    };
  }

  // Cross-currency: look up the rate in the cache.
  const rate = lookupRate(cache, fromCurrency, toCurrency);

  if (rate === undefined) {
    // No rate available — signal conversion unavailable (Req 14.4).
    return { converted: false, original };
  }

  // Integer-friendly conversion: Math.round(amountMinor * ratePpm / 1_000_000)
  const convertedAmount = Math.round(
    (amountMinor * rate.ratePpm) / IDENTITY_RATE_PPM,
  );

  return {
    converted: true,
    amountMinor: convertedAmount,
    rate,
    original,
  };
}

// ---------------------------------------------------------------------------
// CurrencyDisplay namespace object
// ---------------------------------------------------------------------------

/**
 * The `CurrencyDisplay` object groups the currency display conversion
 * functions as specified in the design's component interface.
 */
export const CurrencyDisplay = {
  convert,
  lookupRate,
} as const;
