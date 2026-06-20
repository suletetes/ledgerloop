"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Label } from "../../../../components/ui/label";
import { SubmitButton } from "../../../../components/ui/submit-button";
import type { CreateGroupState } from "./page";

/**
 * Client-side create group form (Req 3.5, 17.4, 17.5, 22.4).
 *
 * On success shows invite/add-members affordance.
 */
interface CreateGroupFormProps {
  action: (prevState: CreateGroupState, formData: FormData) => Promise<CreateGroupState>;
}

export function CreateGroupForm({ action }: CreateGroupFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  // Success state  show invite affordance (Req 3.5)
  if (state.success && state.groupId) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-success/10 p-4">
          <p className="font-medium text-success">
            Group &ldquo;{state.groupName}&rdquo; created!
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
          <h2 className="font-medium text-neutral-900">Add members</h2>
          <p className="text-sm text-neutral-500">
            Share this group ID with friends so they can join:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-neutral-100 px-3 py-2 text-xs text-neutral-700 font-mono break-all">
              {state.groupId}
            </code>
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href={`/groups/${state.groupId}`}
            className="inline-flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
          >
            Go to group
          </Link>
          <Link
            href="/groups"
            className="inline-flex min-h-touch items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
          >
            Back to groups
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Group Name */}
      <div className="space-y-1">
        <Label htmlFor="name">Group name</Label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={state.values?.name ?? ""}
          aria-describedby={state.fieldErrors?.name ? "name-error" : undefined}
          aria-invalid={state.fieldErrors?.name ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="e.g. Flat expenses, Trip to Lagos"
        />
        {state.fieldErrors?.name && (
          <p id="name-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.name}
          </p>
        )}
      </div>

      {/* Base Currency */}
      <div className="space-y-1">
        <Label htmlFor="baseCurrency">Base currency</Label>
        <input
          id="baseCurrency"
          name="baseCurrency"
          type="text"
          defaultValue={state.values?.baseCurrency ?? "USD"}
          aria-describedby={state.fieldErrors?.baseCurrency ? "baseCurrency-error" : undefined}
          aria-invalid={state.fieldErrors?.baseCurrency ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="USD"
          maxLength={3}
        />
        {state.fieldErrors?.baseCurrency && (
          <p id="baseCurrency-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.baseCurrency}
          </p>
        )}
      </div>

      <SubmitButton pending={pending}>Create group</SubmitButton>
    </form>
  );
}
