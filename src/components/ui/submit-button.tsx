"use client";

import * as React from "react";
import { cn } from "../utils/cn";

/**
 * SubmitButton  resilient form submission button (Req 20.5, 22.3, 22.5).
 *
 * - Shows progress indication while in flight (Req 20.5)
 * - Prevents duplicate submission (disabled while pending)
 * - On unavailability: shows unavailability state, allows retry without losing data (Req 22.3)
 * - Clears input only on success (Req 22.5)
 */
export interface SubmitButtonProps {
  /** Button label text. */
  children: React.ReactNode;
  /** Whether the form is currently submitting. */
  pending?: boolean;
  /** Whether the last submission encountered an unavailability error. */
  unavailable?: boolean;
  /** Additional CSS class names. */
  className?: string;
  /** Button type  defaults to "submit". */
  type?: "submit" | "button";
  /** Click handler for retry scenarios. */
  onClick?: () => void;
  /** Whether the button is disabled beyond pending state. */
  disabled?: boolean;
}

export function SubmitButton({
  children,
  pending = false,
  unavailable = false,
  className,
  type = "submit",
  onClick,
  disabled = false,
}: SubmitButtonProps) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type={type}
        disabled={pending || disabled}
        onClick={onClick}
        aria-busy={pending}
        aria-disabled={pending || disabled}
        className={cn(
          "inline-flex min-h-touch min-w-touch items-center justify-center gap-2",
          "rounded-md px-4 py-2 text-sm font-medium text-white",
          "bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors",
          className,
        )}
      >
        {pending && (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            role="status"
            aria-label="Submitting"
          />
        )}
        {pending ? "Submitting…" : children}
      </button>
      {unavailable && (
        <p
          role="alert"
          className="text-xs text-warning"
        >
          Service temporarily unavailable. Your data is preserved  please retry.
        </p>
      )}
    </div>
  );
}
