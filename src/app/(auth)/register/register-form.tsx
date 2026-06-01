"use client";

import * as React from "react";
import { useActionState } from "react";
import { Label } from "../../../components/ui/label";
import { SubmitButton } from "../../../components/ui/submit-button";
import type { RegisterState } from "./page";

/**
 * Client-side registration form (Req 17.4, 17.5, 22.4).
 *
 * - Every input has a programmatically associated label (Req 17.4)
 * - Errors conveyed through text associated with the control (Req 17.5)
 * - Touch targets ≥44px (Req 18.2)
 * - Preserves input on rejection (Req 22.4)
 */
interface RegisterFormProps {
  action: (prevState: RegisterState, formData: FormData) => Promise<RegisterState>;
}

export function RegisterForm({ action }: RegisterFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && (
        <div role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </div>
      )}

      {/* Display Name */}
      <div className="space-y-1">
        <Label htmlFor="displayName">Display name</Label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          autoComplete="name"
          defaultValue={state.values?.displayName ?? ""}
          aria-describedby={state.fieldErrors?.displayName ? "displayName-error" : undefined}
          aria-invalid={state.fieldErrors?.displayName ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="Your name"
        />
        {state.fieldErrors?.displayName && (
          <p id="displayName-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.displayName}
          </p>
        )}
      </div>

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
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          aria-invalid={state.fieldErrors?.email ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="you@example.com"
        />
        {state.fieldErrors?.email && (
          <p id="email-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
          aria-invalid={state.fieldErrors?.password ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="At least 8 characters"
        />
        {state.fieldErrors?.password && (
          <p id="password-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      {/* Home Region */}
      <div className="space-y-1">
        <Label htmlFor="homeRegion">Home region</Label>
        <input
          id="homeRegion"
          name="homeRegion"
          type="text"
          required
          defaultValue={state.values?.homeRegion ?? ""}
          aria-describedby={state.fieldErrors?.homeRegion ? "homeRegion-error" : undefined}
          aria-invalid={state.fieldErrors?.homeRegion ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="e.g. Lagos, London, Toronto"
        />
        {state.fieldErrors?.homeRegion && (
          <p id="homeRegion-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.homeRegion}
          </p>
        )}
      </div>

      {/* Currency Preference */}
      <div className="space-y-1">
        <Label htmlFor="currencyPref">Preferred currency</Label>
        <input
          id="currencyPref"
          name="currencyPref"
          type="text"
          defaultValue={state.values?.currencyPref ?? "USD"}
          aria-describedby={state.fieldErrors?.currencyPref ? "currencyPref-error" : undefined}
          aria-invalid={state.fieldErrors?.currencyPref ? "true" : undefined}
          className="w-full min-h-touch rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          placeholder="USD"
          maxLength={3}
        />
        {state.fieldErrors?.currencyPref && (
          <p id="currencyPref-error" role="alert" className="text-xs text-danger">
            {state.fieldErrors.currencyPref}
          </p>
        )}
      </div>

      <SubmitButton pending={pending}>Create account</SubmitButton>

      <p className="text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <a href="/sign-in" className="text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded">
          Sign in
        </a>
      </p>
    </form>
  );
}
