"use client";

import * as React from "react";
import { Label } from "../ui/label";
import { MoneyInput } from "../ui/money-input";
import { MoneyAmount } from "../ui/money-amount";
import { SubmitButton } from "../ui/submit-button";
import { equalSplit, percentSplit } from "../../domain/split-calculator";
import { isValidCurrency } from "../../domain/money";
import type { SplitType, Split } from "../../domain/types";

/**
 * AddExpenseFlow — single primary flow for adding an expense (Req 15.1-15.6, 22.4).
 *
 * - Amount, currency, description, payer, splitType, participants (Req 15.1)
 * - For 'equal': shows each participant's computed share before submit (Req 15.2)
 * - For 'percent'/'exact': running total + reconcile indicator (Req 15.3)
 * - Blocks submission when shares don't reconcile, shows difference (Req 15.4)
 * - On success: returns to group view with updated balances (Req 15.5)
 * - On rejection: preserves entered values, shows reason next to field (Req 15.6)
 */

interface Member {
  id: string;
  displayName: string;
}

export interface AddExpenseFlowProps {
  groupId: string;
  members: Member[];
  currentUserId: string;
  baseCurrency: string;
  onSuccess?: () => void;
}

interface FormState {
  amountMinor: number | null;
  amountDisplay: string;
  currency: string;
  description: string;
  paidBy: string;
  splitType: SplitType;
  participants: string[];
  percents: Record<string, string>;
  exactShares: Record<string, string>;
}

export function AddExpenseFlow({
  groupId: _groupId,
  members,
  currentUserId,
  baseCurrency,
  onSuccess,
}: AddExpenseFlowProps) {
  const [form, setForm] = React.useState<FormState>({
    amountMinor: null,
    amountDisplay: "",
    currency: baseCurrency,
    description: "",
    paidBy: currentUserId,
    splitType: "equal",
    participants: members.map((m) => m.id),
    percents: {},
    exactShares: {},
  });

  const [pending, setPending] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Compute live split preview
  const splitPreview = React.useMemo((): {
    splits: Split[];
    total: number;
    reconciled: boolean;
    difference: number;
  } => {
    if (!form.amountMinor || form.participants.length === 0) {
      return { splits: [], total: 0, reconciled: false, difference: 0 };
    }

    const amount = form.amountMinor;

    if (form.splitType === "equal") {
      const splits = equalSplit(amount, form.participants);
      return { splits, total: amount, reconciled: true, difference: 0 };
    }

    if (form.splitType === "percent") {
      const percents = form.participants.map(
        (id) => parseFloat(form.percents[id] || "0") || 0,
      );
      const percentTotal = percents.reduce((a, b) => a + b, 0);
      if (percentTotal !== 100) {
        const estimatedTotal = percents.reduce(
          (sum, pct) => sum + Math.floor((amount * pct) / 100),
          0,
        );
        return {
          splits: form.participants.map((id, i) => ({
            userId: id,
            shareMinor: Math.floor((amount * percents[i]!) / 100),
          })),
          total: estimatedTotal,
          reconciled: false,
          difference: amount - estimatedTotal,
        };
      }
      const result = percentSplit(amount, form.participants, percents);
      if (result.ok) {
        return { splits: result.value, total: amount, reconciled: true, difference: 0 };
      }
      return { splits: [], total: 0, reconciled: false, difference: amount };
    }

    // exact
    const shares = form.participants.map(
      (id) => parseInt(form.exactShares[id] || "0", 10) || 0,
    );
    const total = shares.reduce((a, b) => a + b, 0);
    return {
      splits: form.participants.map((id, i) => ({
        userId: id,
        shareMinor: shares[i]!,
      })),
      total,
      reconciled: total === amount,
      difference: amount - total,
    };
  }, [form.amountMinor, form.splitType, form.participants, form.percents, form.exactShares]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setSubmitError(null);

    // Client-side validation
    const errors: Record<string, string> = {};

    if (!form.amountMinor || form.amountMinor <= 0) {
      errors.amount = "Amount must be greater than zero";
    }
    if (!form.currency || !isValidCurrency(form.currency)) {
      errors.currency = "Please enter a valid currency code";
    }
    if (!form.description.trim()) {
      errors.description = "Description is required";
    } else if (form.description.trim().length > 500) {
      errors.description = "Description must be 500 characters or fewer";
    }
    if (form.participants.length === 0) {
      errors.participants = "Select at least one participant";
    }
    if (!splitPreview.reconciled) {
      errors.split = `Shares do not add up to the expense amount. Difference: ${splitPreview.difference} minor units`;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setPending(true);
    setUnavailable(false);

    try {
      // TODO: Wire to server action / API call
      // For now, simulate success
      await new Promise((resolve) => setTimeout(resolve, 500));
      onSuccess?.();
    } catch {
      // Check if it's an unavailability error (Req 22.3)
      setUnavailable(true);
      setSubmitError("Failed to add expense. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.displayName ?? id;

  const toggleParticipant = (id: string) => {
    setForm((prev) => ({
      ...prev,
      participants: prev.participants.includes(id)
        ? prev.participants.filter((p) => p !== id)
        : [...prev.participants, id],
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {submitError && (
        <div role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger">
          {submitError}
        </div>
      )}

      {/* Amount (Req 15.1) */}
      <div className="space-y-1">
        <Label htmlFor="expense-amount">Amount</Label>
        <MoneyInput
          id="expense-amount"
          name="amount"
          currency={form.currency}
          value={form.amountDisplay}
          onChange={(minor) => setForm((prev) => ({ ...prev, amountMinor: minor }))}
          aria-describedby={fieldErrors.amount ? "amount-error" : undefined}
        />
        {fieldErrors.amount && (
          <p id="amount-error" role="alert" className="text-xs text-danger">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      {/* Currency */}
      <div className="space-y-1">
        <Label htmlFor="expense-currency">Currency</Label>
        <input
          id="expense-currency"
          name="currency"
          type="text"
          value={form.currency}
          onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
          maxLength={3}
          aria-describedby={fieldErrors.currency ? "currency-error" : undefined}
          aria-invalid={fieldErrors.currency ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        />
        {fieldErrors.currency && (
          <p id="currency-error" role="alert" className="text-xs text-danger">
            {fieldErrors.currency}
          </p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label htmlFor="expense-description">Description</Label>
        <input
          id="expense-description"
          name="description"
          type="text"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          aria-describedby={fieldErrors.description ? "description-error" : undefined}
          aria-invalid={fieldErrors.description ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="What was this expense for?"
        />
        {fieldErrors.description && (
          <p id="description-error" role="alert" className="text-xs text-danger">
            {fieldErrors.description}
          </p>
        )}
      </div>

      {/* Paid by */}
      <div className="space-y-1">
        <Label htmlFor="expense-paidby">Paid by</Label>
        <select
          id="expense-paidby"
          name="paidBy"
          value={form.paidBy}
          onChange={(e) => setForm((prev) => ({ ...prev, paidBy: e.target.value }))}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}{m.id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Split type */}
      <div className="space-y-1">
        <Label htmlFor="expense-splittype">Split type</Label>
        <select
          id="expense-splittype"
          name="splitType"
          value={form.splitType}
          onChange={(e) => setForm((prev) => ({ ...prev, splitType: e.target.value as SplitType }))}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="equal">Split equally</option>
          <option value="percent">Split by percentage</option>
          <option value="exact">Split by exact amounts</option>
        </select>
      </div>

      {/* Participants */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-neutral-700">Participants</legend>
        {fieldErrors.participants && (
          <p role="alert" className="text-xs text-danger">
            {fieldErrors.participants}
          </p>
        )}
        <div className="space-y-1">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex min-h-touch items-center gap-2 rounded-md px-2 py-1 hover:bg-neutral-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form.participants.includes(m.id)}
                onChange={() => toggleParticipant(m.id)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-neutral-900">{m.displayName}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Percent/Exact inputs */}
      {form.splitType === "percent" && form.participants.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-neutral-700">Percentages</legend>
          {form.participants.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <span className="w-24 text-sm text-neutral-700 truncate">{getMemberName(id)}</span>
              <input
                type="number"
                min="0"
                max="100"
                value={form.percents[id] ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    percents: { ...prev.percents, [id]: e.target.value },
                  }))
                }
                aria-label={`Percentage for ${getMemberName(id)}`}
                className="w-20 min-h-touch rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-sm text-neutral-500">%</span>
            </div>
          ))}
        </fieldset>
      )}

      {form.splitType === "exact" && form.participants.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-neutral-700">Exact shares (minor units)</legend>
          {form.participants.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <span className="w-24 text-sm text-neutral-700 truncate">{getMemberName(id)}</span>
              <input
                type="number"
                min="0"
                value={form.exactShares[id] ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    exactShares: { ...prev.exactShares, [id]: e.target.value },
                  }))
                }
                aria-label={`Exact share for ${getMemberName(id)}`}
                className="w-24 min-h-touch rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          ))}
        </fieldset>
      )}

      {/* Split Preview (Req 15.2, 15.3, 15.4) */}
      {form.amountMinor && form.participants.length > 0 && (
        <div
          className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-2"
          aria-label="Split preview"
        >
          <h3 className="text-sm font-medium text-neutral-700">Split preview</h3>

          {splitPreview.splits.map((split) => (
            <div key={split.userId} className="flex items-center justify-between text-sm">
              <span className="text-neutral-700">{getMemberName(split.userId)}</span>
              <MoneyAmount
                amountMinor={split.shareMinor}
                currency={form.currency}
              />
            </div>
          ))}

          {/* Reconcile indicator (Req 15.3, 15.4) */}
          {form.splitType !== "equal" && (
            <div className="mt-2 border-t border-neutral-200 pt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600">Total assigned:</span>
                <MoneyAmount amountMinor={splitPreview.total} currency={form.currency} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600">Expense amount:</span>
                <MoneyAmount amountMinor={form.amountMinor} currency={form.currency} />
              </div>
              {!splitPreview.reconciled && (
                <p role="alert" className="mt-1 text-xs text-danger font-medium">
                  ⚠ Difference: {splitPreview.difference} minor units. Shares must equal the expense amount.
                </p>
              )}
              {splitPreview.reconciled && (
                <p className="mt-1 text-xs text-success font-medium">
                  ✓ Shares reconcile with the expense amount.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Split error */}
      {fieldErrors.split && (
        <p role="alert" className="text-xs text-danger">
          {fieldErrors.split}
        </p>
      )}

      <SubmitButton
        pending={pending}
        unavailable={unavailable}
        disabled={!splitPreview.reconciled && form.splitType !== "equal"}
      >
        Add expense
      </SubmitButton>
    </form>
  );
}
