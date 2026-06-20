"use client";

import * as React from "react";
import { parseMajorToMinor } from "../../domain/money";
import { cn } from "../utils/cn";

/**
 * Props for the MoneyInput component.
 *
 * Accepts a major-unit value from the user and converts it to integer minor
 * units via parseMajorToMinor before calling the onChange callback (Req 12.4).
 */
export interface MoneyInputProps {
  /** The ISO-4217 currency code governing minor-unit conversion. */
  currency: string;
  /** Called with the converted integer minor units on valid input. */
  onChange: (minorUnits: number | null) => void;
  /** Optional initial display value (major units string). */
  value?: string;
  /** Input id for label association (Req 17.4). */
  id?: string;
  /** Input name attribute. */
  name?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper. */
  className?: string;
  /** aria-describedby for external error association. */
  "aria-describedby"?: string;
}

/**
 * MoneyInput  accessible input component for monetary amounts.
 *
 * - Accepts major-unit values (e.g. "12.34") from the user
 * - Converts to integer minor units via parseMajorToMinor before submission (Req 12.4)
 * - Shows validation errors inline (Req 17.5, 22.4)
 * - Uses proper semantic HTML with aria attributes for screen readers
 */
export function MoneyInput({
  currency,
  onChange,
  value: controlledValue,
  id,
  name,
  placeholder,
  disabled,
  className,
  "aria-describedby": ariaDescribedBy,
}: MoneyInputProps) {
  const [displayValue, setDisplayValue] = React.useState(controlledValue ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const errorId = id ? `${id}-error` : undefined;

  // Sync with controlled value prop changes.
  React.useEffect(() => {
    if (controlledValue !== undefined) {
      setDisplayValue(controlledValue);
    }
  }, [controlledValue]);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setDisplayValue(raw);

      // Allow empty input (clear state).
      if (raw.trim() === "") {
        setError(null);
        onChange(null);
        return;
      }

      const result = parseMajorToMinor(raw, currency);

      if (result.ok) {
        setError(null);
        onChange(result.value);
      } else {
        setError(result.error.message);
        onChange(null);
      }
    },
    [currency, onChange],
  );

  const describedBy = [ariaDescribedBy, error ? errorId : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <input
        type="text"
        inputMode="decimal"
        id={id}
        name={name}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-md border px-3 py-2 text-sm",
          "border-neutral-300 bg-white text-neutral-900",
          "placeholder:text-neutral-400",
          "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-danger ring-1 ring-danger",
        )}
      />
      {error && (
        <span
          id={errorId}
          role="alert"
          className="text-xs text-danger"
        >
          {error}
        </span>
      )}
    </div>
  );
}
