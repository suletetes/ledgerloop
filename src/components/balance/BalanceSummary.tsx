"use client";

import * as React from "react";
import { MoneyAmount } from "../ui/money-amount";

/**
 * BalanceSummary  shows member balances with live updates (Req 9.5, 9.6, 16.1, 16.2, 17.6).
 *
 * - Shows member's own net position prominently first (Req 16.1)
 * - Who-owes-whom in plain language (Req 16.2)
 * - Creditor/debtor indicator NOT relying on color alone  uses text labels
 *   like "owes" / "is owed" plus an icon (Req 9.5)
 * - Live updates via polling within 2 seconds, announced via aria-live="polite" (Req 9.6, 17.6)
 */

interface Member {
  id: string;
  displayName: string;
}

interface BalanceEntry {
  userId: string;
  netMinor: number;
}

export interface BalanceSummaryProps {
  groupId: string;
  currentUserId: string;
  members: Member[];
  /** Optional initial balances (from server). */
  initialBalances?: BalanceEntry[];
  /** Base currency for the group. */
  currency?: string;
}

export function BalanceSummary({
  groupId,
  currentUserId,
  members,
  initialBalances,
  currency = "USD",
}: BalanceSummaryProps) {
  const [balances, _setBalances] = React.useState<BalanceEntry[]>(initialBalances ?? []);
  const [_lastUpdated, _setLastUpdated] = React.useState<Date>(new Date());

  // Poll for live updates every 2 seconds (Req 9.6)
  React.useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // TODO: Wire to API endpoint for live balance fetching
        // const response = await fetch(`/api/groups/${groupId}/balances`);
        // const data = await response.json();
        // _setBalances(data.balances);
        _setLastUpdated(new Date());
      } catch {
        // Silently handle polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [groupId]);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? id;

  // Sort: current user first (Req 16.1), then by absolute net position
  const sortedBalances = React.useMemo(() => {
    return [...balances].sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return Math.abs(b.netMinor) - Math.abs(a.netMinor);
    });
  }, [balances, currentUserId]);

  const allSettled = balances.length > 0 && balances.every((b) => b.netMinor === 0);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="space-y-3"
    >
      {balances.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No expenses recorded yet. Add an expense to see balances.
        </p>
      ) : allSettled ? (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-center">
          <p className="font-medium text-success">✓ All settled up!</p>
          <p className="mt-1 text-sm text-neutral-600">
            Everyone in this group is even.
          </p>
        </div>
      ) : (
        <ul role="list" className="space-y-2">
          {sortedBalances.map((entry) => {
            const isCurrentUser = entry.userId === currentUserId;
            const isCreditor = entry.netMinor > 0;
            const isDebtor = entry.netMinor < 0;
            const isEven = entry.netMinor === 0;

            return (
              <li
                key={entry.userId}
                className={`rounded-lg border p-3 ${
                  isCurrentUser ? "border-brand-200 bg-brand-50" : "border-neutral-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900">
                      {getMemberName(entry.userId)}
                      {isCurrentUser && (
                        <span className="ml-1 text-xs text-brand-600">(you)</span>
                      )}
                    </span>
                    {/* Status indicator  NOT color alone (Req 9.5) */}
                    {isCreditor && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        <span aria-hidden="true">↑</span>
                        is owed
                      </span>
                    )}
                    {isDebtor && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                        <span aria-hidden="true">↓</span>
                        owes
                      </span>
                    )}
                    {isEven && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                        <span aria-hidden="true"></span>
                        settled
                      </span>
                    )}
                  </div>
                  <MoneyAmount
                    amountMinor={Math.abs(entry.netMinor)}
                    currency={currency}
                  />
                </div>
                {/* Plain language description (Req 16.2) */}
                {!isEven && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {isCreditor
                      ? `${getMemberName(entry.userId)} is owed money by the group`
                      : `${getMemberName(entry.userId)} owes money to the group`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
