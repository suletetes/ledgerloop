"use client";

import * as React from "react";
import { useActionState } from "react";
import { Label } from "../../../components/ui/label";
import { SubmitButton } from "../../../components/ui/submit-button";
import type { SignInState } from "./page";

/**
 * Client-side sign-in form (Req 2.1, 2.2, 17.4, 17.5, 22.4).
 *
 * - Non-enumerating error message (Req 2.2)
 * - Every input has a programmatically associated label (Req 17.4)
 * - Errors conveyed through text (Req 17.5)
 * - Touch targets ≥44px (Req 18.2)
 * - Preserves email on rejection (Req 22.4)
 */
interface SignInFormProps {
  action: (prevState: SignInState, formData: FormData) => Promise<SignInState>;
}

export function SignInForm({ action }: SignInFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && (
        <div role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </div>
      )}

      {/* Email */}
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={state.values?.email ?? ""}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="you@example.com"
        />
      </div>

      {/* Password */}
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="Your password"
        />
      </div>

      <SubmitButton pending={pending}>Sign in</SubmitButton>

      <p className="text-center text-sm text-neutral-500">
        Don&apos;t have an account?{" "}
        <a href="/register" className="text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded">
          Create one
        </a>
      </p>
    </form>
  );
}
