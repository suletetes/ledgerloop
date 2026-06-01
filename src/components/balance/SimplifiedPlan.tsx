"use client";

import * as React from "react";
import { MoneyAmount } from "../ui/money-amount";
import type { Transfer } from "../../domain/types";
import type { FxRateCache } from "../../domain/currency-display";

/**
 * SimplifiedPlan — shows the minimum-payment transfer plan (Req 10.5, 10.8).
 *
 * - Each transfer: payer, receiver, amount in viewer's currency (Req 10.5)
 * - FX unavailable fallback (Req 10.8)
 * - Uses MoneyAmount component for proper formatting
 */

interface Member {
  id: string;
  displayName: string;
}

export interface SimplifiedPlanProps {
  groupId: string;
  viewerCurrency: string;
  members: Member[];
  /** Optional initial transfers (from server). */
  initialTransfers?: Transfer[];
  /** The currency the transfers are stored in. */
  transferCurrency?: string;
  /** FX rate cache for cross-currency display. */
  fxRates?: FxRateCache;
}

export function SimplifiedPlan({
  groupId: _groupId,
  viewerCurrency,
  members,
  initialTransfers,
  transferCurrency = "USD",
  fxRates,
}: SimplifiedPlanProps) {
  const [transfers, _setTransfers] = React.useState<Transfer[]>(initialTransfers ?? []);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? id;

  if (transfers.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-center">
        <p className="text-sm text-neutral-500">
          No payments needed — everyone is settled up.
        </p>
      </div>
    );
  }

  return (
    <ul role="list" className="space-y-2">
      {transfers.map((transfer, index) => (
        <li
          key={`${transfer.from}-${transfer.to}-${index}`}
          className="flex items-center justify-between rounded-lg border border-neutral-200 p-3"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-neutral-900">
              {getMemberName(transfer.from)}
            </span>
            <span className="text-neutral-400" aria-hidden="true">→</span>
            <span className="sr-only">pays</span>
            <span className="font-medium text-neutral-900">
              {getMemberName(transfer.to)}
            </span>
          </div>
          <MoneyAmount
            amountMinor={transfer.amountMinor}
            currency={transferCurrency}
            viewerCurrency={viewerCurrency !== transferCurrency ? viewerCurrency : undefined}
            fxRates={fxRates}
          />
        </li>
      ))}
    </ul>
  );
}
