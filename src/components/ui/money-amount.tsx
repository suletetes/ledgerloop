"use client";

import * as React from "react";
import { formatMinor, isValidCurrency } from "../../domain/money";
import {
  convert,
  type FxRateCache,
} from "../../domain/currency-display";
import { cn } from "../utils/cn";

/**
 * Props for the MoneyAmount display component.
 *
 * Displays a monetary amount stored as integer minor units in its correct
 * major/minor presentation (Req 12.3). When a viewer currency differs from the
 * stored currency and an FX rate is available, shows the converted amount AND
 * the original (Req 14.3). When no FX rate is available, shows the original
 * with a "conversion unavailable" indicator (Req 14.4, 10.8).
 */
export interface MoneyAmountProps {
  /** The amount in integer minor units (e.g. 1234 for $12.34). */
  amountMinor: number;
  /** The ISO-4217 currency code the amount is stored in. */
  currency: string;
  /** The viewer's preferred display currency (ISO-4217). Optional. */
  viewerCurrency?: string;
  /** FX rate cache for cross-currency conversion. Optional. */
  fxRates?: FxRateCache;
  /** Additional CSS class names. */
  className?: string;
}

/**
 * MoneyAmount  shared component for displaying monetary amounts.
 *
 * - Formats integer minor units into correct major/minor presentation (Req 12.3)
 * - Always exposes the original amount alongside any converted value (Req 14.3)
 * - When no FX rate exists, shows original currency/amount and indicates
 *   conversion is unavailable (Req 14.4, 10.8)
 * - Uses semantic HTML with aria-label for screen readers (Req 17)
 * - Renders nothing when the currency code is not yet valid (e.g. mid-edit)
 *   to prevent formatMinor from throwing during intermediate input states.
 */
export function MoneyAmount({
  amountMinor,
  currency,
  viewerCurrency,
  fxRates,
  className,
}: MoneyAmountProps) {
  // Guard: formatMinor throws a RangeError on unknown currency codes.
  // During currency field editing the code passes through intermediate states
  // like "N" or "NG" — render nothing rather than crash the page.
  if (!isValidCurrency(currency)) {
    return null;
  }

  const formattedOriginal = formatMinor(amountMinor, currency);

  // If no viewer currency or same currency, just show the original.
  if (!viewerCurrency || viewerCurrency === currency) {
    return (
      <span
        className={cn("inline-flex items-baseline gap-1", className)}
        aria-label={`${formattedOriginal} ${currency}`}
      >
        <span className="font-medium">{formattedOriginal}</span>
        <span className="text-xs text-neutral-500">{currency}</span>
      </span>
    );
  }

  // Cross-currency: attempt conversion.
  const cache = fxRates ?? new Map();
  const result = convert(amountMinor, currency, viewerCurrency, cache);

  if (result.converted) {
    const formattedConverted = formatMinor(result.amountMinor, viewerCurrency);
    return (
      <span
        className={cn("inline-flex flex-wrap items-baseline gap-1", className)}
        aria-label={`${formattedConverted} ${viewerCurrency}, originally ${formattedOriginal} ${currency}`}
      >
        <span className="font-medium">{formattedConverted}</span>
        <span className="text-xs text-neutral-500">{viewerCurrency}</span>
        <span
          className="text-xs text-neutral-400"
          aria-label={`originally ${formattedOriginal} ${currency}`}
        >
          ({formattedOriginal} {currency})
        </span>
      </span>
    );
  }

  // No FX rate available  show original with unavailable indicator (Req 14.4, 10.8).
  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-1", className)}
      aria-label={`${formattedOriginal} ${currency}, conversion to ${viewerCurrency} unavailable`}
    >
      <span className="font-medium">{formattedOriginal}</span>
      <span className="text-xs text-neutral-500">{currency}</span>
      <span
        className="text-xs italic text-neutral-400"
        role="note"
        aria-label={`Conversion to ${viewerCurrency} unavailable`}
      >
        ({viewerCurrency} unavailable)
      </span>
    </span>
  );
}
