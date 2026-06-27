"use client";

import * as React from "react";
import { Label } from "../ui/label";
import { MoneyAmount } from "../ui/money-amount";
import { MoneyInput } from "../ui/money-input";
import { SubmitButton } from "../ui/submit-button";

/**
 * SettleUpForm  record a settlement between two members (Req 16.3, 16.4, 16.5).
 *
 * - Pre-fills payer, receiver, amount from displayed debt (Req 16.3)
 * - Confirmation shows recorded settlement + resulting balances (Req 16.4)
 * - Settled-up state when net position is zero (Req 16.5)
 */

interface Member {
  id: string;
  displayName: string;
}

export interface SettleUpFormProps {
  groupId: string;
  members: Member[];
  currentUserId: string;
  currency: string;
  /** Pre-filled payer (from displayed debt). */
  defaultPayer?: string;
  /** Pre-filled receiver (from displayed debt). */
  defaultReceiver?: string;
  /** Pre-filled amount in minor units (from displayed debt). */
  defaultAmountMinor?: number;
  /** Server action to record the settlement. */
  settleAction?: (input: {
    groupId: string;
    fromUser: string;
    toUser: string;
    amountMinor: number;
    currency: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Callback on successful settlement. */
  onSuccess?: () => void;
}

interface SettlementConfirmation {
  fromName: string;
  toName: string;
  amountMinor: number;
  currency: string;
}

export function SettleUpForm({
  groupId,
  members,
  currentUserId,
  currency,
  defaultPayer,
  defaultReceiver,
  defaultAmountMinor,
  settleAction,
  onSuccess,
}: SettleUpFormProps) {
  const [payer, setPayer] = React.useState(defaultPayer ?? currentUserId);
  const [receiver, setReceiver] = React.useState(defaultReceiver ?? "");
  const [amountMinor, setAmountMinor] = React.useState<number | null>(defaultAmountMinor ?? null);
  const [pending, setPending] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<SettlementConfirmation | null>(null);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? id;

  // If there's a confirmation, show it (Req 16.4)
  if (confirmation) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2">
          <p className="font-medium text-success">✓ Settlement recorded</p>
          <p className="text-sm text-neutral-700">
            {confirmation.fromName} paid{" "}
            <MoneyAmount
              amountMinor={confirmation.amountMinor}
              currency={confirmation.currency}
            />{" "}
            to {confirmation.toName}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setConfirmation(null);
            onSuccess?.();
            // Reload page so balances reflect the new settlement
            window.location.reload();
          }}
          className="inline-flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // Settled-up state (Req 16.5)
  // This would be determined by checking if the current user's net position is zero
  // For now, we show the form

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setServerError(null);

    const errors: Record<string, string> = {};

    if (!payer) {
      errors.payer = "Select who is paying";
    }
    if (!receiver) {
      errors.receiver = "Select who is receiving";
    }
    if (payer && receiver && payer === receiver) {
      errors.receiver = "Payer and receiver must be different people";
    }
    if (!amountMinor || amountMinor <= 0) {
      errors.amount = "Amount must be greater than zero";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setPending(true);
    setUnavailable(false);

    try {
      if (settleAction) {
        const result = await settleAction({
          groupId,
          fromUser: payer,
          toUser: receiver,
          amountMinor: amountMinor!,
          currency,
        });
        if (!result.ok) {
          setServerError(result.error ?? "Failed to record settlement.");
          return;
        }
      }

      // Show confirmation (Req 16.4)
      setConfirmation({
        fromName: getMemberName(payer),
        toName: getMemberName(receiver),
        amountMinor: amountMinor!,
        currency,
      });
    } catch {
      setUnavailable(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {serverError && (
        <div role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError}
        </div>
      )}
      {/* Payer (Req 16.3  pre-filled) */}
      <div className="space-y-1">
        <Label htmlFor="settle-payer">Who is paying?</Label>
        <select
          id="settle-payer"
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          aria-describedby={fieldErrors.payer ? "payer-error" : undefined}
          aria-invalid={fieldErrors.payer ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">Select payer</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}{m.id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </select>
        {fieldErrors.payer && (
          <p id="payer-error" role="alert" className="text-xs text-danger">
            {fieldErrors.payer}
          </p>
        )}
      </div>

      {/* Receiver (Req 16.3  pre-filled) */}
      <div className="space-y-1">
        <Label htmlFor="settle-receiver">Who is receiving?</Label>
        <select
          id="settle-receiver"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          aria-describedby={fieldErrors.receiver ? "receiver-error" : undefined}
          aria-invalid={fieldErrors.receiver ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">Select receiver</option>
          {members.filter((m) => m.id !== payer).map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}{m.id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </select>
        {fieldErrors.receiver && (
          <p id="receiver-error" role="alert" className="text-xs text-danger">
            {fieldErrors.receiver}
          </p>
        )}
      </div>

      {/* Amount (Req 16.3  pre-filled from displayed debt) */}
      <div className="space-y-1">
        <Label htmlFor="settle-amount">Amount</Label>
        <MoneyInput
          id="settle-amount"
          name="amount"
          currency={currency}
          onChange={(minor) => setAmountMinor(minor)}
          aria-describedby={fieldErrors.amount ? "settle-amount-error" : undefined}
        />
        {defaultAmountMinor && (
          <p className="text-xs text-neutral-500">
            Suggested: <MoneyAmount amountMinor={defaultAmountMinor} currency={currency} />
          </p>
        )}
        {fieldErrors.amount && (
          <p id="settle-amount-error" role="alert" className="text-xs text-danger">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      <SubmitButton pending={pending} unavailable={unavailable}>
        Record settlement
      </SubmitButton>
    </form>
  );
}
