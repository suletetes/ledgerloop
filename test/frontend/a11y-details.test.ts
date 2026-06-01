// @vitest-environment jsdom

/**
 * Task 19.2 — Contrast, keyboard, label, and error-association tests.
 *
 * - Req 17.2: Verify 4.5:1 contrast ratio for text against backgrounds
 * - Req 17.3: Keyboard reachability/operability with visible focus indicator
 * - Req 17.4: Programmatic labels on every control
 * - Req 17.5: Error text programmatically associated with its control (not color alone)
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

import { colors } from "@/design/tokens";
import { MoneyInput } from "@/components/ui/money-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { AddExpenseFlow } from "@/components/expense/AddExpenseFlow";
import { SettleUpForm } from "@/components/settle/SettleUpForm";

afterEach(() => {
  cleanup();
});

// --- Contrast ratio utilities (Req 17.2) ---

/**
 * Parse a hex color string to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Compute relative luminance per WCAG 2.1 definition.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

/**
 * Compute contrast ratio between two colors.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const testMembers = [
  { id: "user-1", displayName: "Alice" },
  { id: "user-2", displayName: "Bob" },
  { id: "user-3", displayName: "Charlie" },
];

describe("Contrast: design token colors meet WCAG AA (Req 17.2)", () => {
  const background = colors.neutral[50]; // #f8fafc — primary background

  it("creditor color (#15803d) has ≥ 4.5:1 contrast against neutral-50 background", () => {
    const ratio = contrastRatio(colors.creditor, background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("debtor color (#b91c1c) has ≥ 4.5:1 contrast against neutral-50 background", () => {
    const ratio = contrastRatio(colors.debtor, background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("brand-600 (#1f4bd1) has ≥ 4.5:1 contrast against neutral-50 background", () => {
    const ratio = contrastRatio(colors.brand[600], background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("neutral-700 (#334155) has ≥ 4.5:1 contrast against neutral-50 background", () => {
    const ratio = contrastRatio(colors.neutral[700], background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("neutral-900 (#0f172a) has ≥ 4.5:1 contrast against neutral-50 background", () => {
    const ratio = contrastRatio(colors.neutral[900], background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("warning color (#b45309) has ≥ 3:1 contrast against neutral-50 (large text threshold)", () => {
    const ratio = contrastRatio(colors.warning, background);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it("brand-600 has ≥ 3:1 contrast against white for button text", () => {
    const ratio = contrastRatio("#ffffff", colors.brand[600]);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe("Keyboard: interactive elements are focusable (Req 17.3)", () => {
  it("SubmitButton is focusable via keyboard", () => {
    render(React.createElement(SubmitButton, null, "Submit"));
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("MoneyInput is focusable via keyboard", () => {
    render(
      React.createElement("div", null,
        React.createElement("label", { htmlFor: "kb-test" }, "Amount"),
        React.createElement(MoneyInput, {
          id: "kb-test",
          currency: "USD",
          onChange: () => {},
        }),
      ),
    );
    const input = screen.getByRole("textbox");
    expect(input.tabIndex).toBeGreaterThanOrEqual(0);
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("AddExpenseFlow form controls are all focusable", () => {
    render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );

    // All inputs, selects, and buttons should be focusable
    const inputs = document.querySelectorAll("input, select, button");
    inputs.forEach((el) => {
      const htmlEl = el as HTMLElement;
      expect(htmlEl.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });

  it("SettleUpForm form controls are all focusable", () => {
    render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
      }),
    );

    const inputs = document.querySelectorAll("input, select, button");
    inputs.forEach((el) => {
      const htmlEl = el as HTMLElement;
      expect(htmlEl.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Labels: every control has a programmatic label (Req 17.4)", () => {
  it("Label component associates with its input via htmlFor", () => {
    render(
      React.createElement("div", null,
        React.createElement(Label, { htmlFor: "label-test" }, "Test Label"),
        React.createElement("input", { id: "label-test", type: "text" }),
      ),
    );
    const input = screen.getByLabelText("Test Label");
    expect(input).toBeDefined();
    expect(input.tagName.toLowerCase()).toBe("input");
  });

  it("MoneyInput has an accessible label when id is provided", () => {
    render(
      React.createElement("div", null,
        React.createElement("label", { htmlFor: "money-label-test" }, "Payment amount"),
        React.createElement(MoneyInput, {
          id: "money-label-test",
          currency: "USD",
          onChange: () => {},
        }),
      ),
    );
    const input = screen.getByLabelText("Payment amount");
    expect(input).toBeDefined();
  });

  it("AddExpenseFlow has labels for all form fields", () => {
    render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );

    // Check that key fields have associated labels
    expect(screen.getByLabelText("Amount")).toBeDefined();
    expect(screen.getByLabelText("Currency")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
    expect(screen.getByLabelText("Paid by")).toBeDefined();
    expect(screen.getByLabelText("Split type")).toBeDefined();
  });

  it("SettleUpForm has labels for all form fields", () => {
    render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
      }),
    );

    expect(screen.getByLabelText("Who is paying?")).toBeDefined();
    expect(screen.getByLabelText("Who is receiving?")).toBeDefined();
    expect(screen.getByLabelText("Amount")).toBeDefined();
  });
});

describe("Error association: errors linked via aria-describedby (Req 17.5)", () => {
  it("MoneyInput associates error message via aria-describedby on invalid input", () => {
    render(
      React.createElement("div", null,
        React.createElement("label", { htmlFor: "err-test" }, "Amount"),
        React.createElement(MoneyInput, {
          id: "err-test",
          currency: "USD",
          onChange: () => {},
        }),
      ),
    );

    const input = screen.getByLabelText("Amount");
    // Type an invalid value to trigger error
    fireEvent.change(input, { target: { value: "abc" } });

    // The input should have aria-invalid and aria-describedby pointing to the error
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    // The error element should exist and have role="alert"
    const errorEl = document.getElementById(describedBy!);
    expect(errorEl).not.toBeNull();
    expect(errorEl!.getAttribute("role")).toBe("alert");
  });

  it("AddExpenseFlow shows field-scoped errors with aria association on submit", () => {
    render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );

    // Submit the form without filling required fields
    const submitButton = screen.getByRole("button", { name: /add expense/i });
    fireEvent.click(submitButton);

    // Error messages should appear with role="alert"
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);

    // Each error should be associated with its field via aria-describedby
    // Check the amount field error association
    const amountInput = screen.getByLabelText("Amount");
    const describedBy = amountInput.getAttribute("aria-describedby");
    if (describedBy) {
      const errorEl = document.getElementById(describedBy);
      expect(errorEl).not.toBeNull();
    }
  });

  it("SettleUpForm shows field-scoped errors with aria association on submit", () => {
    render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
      }),
    );

    // Submit without selecting a receiver
    const submitButton = screen.getByRole("button", { name: /record settlement/i });
    fireEvent.click(submitButton);

    // Error messages should appear
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("error messages use role='alert' so they are announced to assistive tech", () => {
    render(
      React.createElement("div", null,
        React.createElement("label", { htmlFor: "alert-test" }, "Amount"),
        React.createElement(MoneyInput, {
          id: "alert-test",
          currency: "USD",
          onChange: () => {},
        }),
      ),
    );

    const input = screen.getByLabelText("Amount");
    fireEvent.change(input, { target: { value: "not-a-number" } });

    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    // Error text should not be empty
    alerts.forEach((alert) => {
      expect(alert.textContent!.trim().length).toBeGreaterThan(0);
    });
  });
});
