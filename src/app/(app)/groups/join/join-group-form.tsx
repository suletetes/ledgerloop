"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Label } from "../../../../components/ui/label";
import { SubmitButton } from "../../../../components/ui/submit-button";
import type { JoinGroupState } from "./page";

interface JoinGroupFormProps {
  action: (prevState: JoinGroupState, formData: FormData) => Promise<JoinGroupState>;
}

export function JoinGroupForm({ action }: JoinGroupFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && (
        <div role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="groupId">Group ID</Label>
        <input
          id="groupId"
          name="groupId"
          type="text"
          defaultValue={state.values?.groupId ?? ""}
          placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
          aria-describedby={state.fieldErrors?.groupId ? "groupId-error" : undefined}
          aria-invalid={state.fieldErrors?.groupId ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        />
        {state.fieldErrors?.groupId && (
          <p id="groupId-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.groupId}
          </p>
        )}
        <p className="text-xs text-neutral-500">
          Ask the group creator to share their group ID with you.
        </p>
      </div>

      <SubmitButton pending={pending}>Join group</SubmitButton>

      <p className="text-sm text-neutral-500">
        <Link
          href="/groups"
          className="text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
        >
          ← Back to my groups
        </Link>
      </p>
    </form>
  );
}
