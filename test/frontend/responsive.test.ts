// @vitest-environment jsdom

/**
 * Task 19.3 — Responsive and touch tests.
 *
 * Since jsdom cannot truly test viewport reflow, these tests verify structural
 * properties of the components:
 *
 * - Req 18.1: No fixed widths that would cause horizontal scroll at 320px
 * - Req 18.2: Touch targets ≥ 44×44px (via min-h-touch / min-w-touch classes)
 * - Req 18.3: No loss of function at different viewport sizes (structural check)
 * - Req 18.4: No hover-only interactions (no onMouseEnter/onMouseOver without click)
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { AddExpenseFlow } from "@/components/expense/AddExpenseFlow";
import { SettleUpForm } from "@/components/settle/SettleUpForm";
import { BalanceSummary } from "@/components/balance/BalanceSummary";
import { SimplifiedPlan } from "@/components/balance/SimplifiedPlan";

afterEach(() => {
  cleanup();
});

const testMembers = [
  { id: "user-1", displayName: "Alice" },
  { id: "user-2", displayName: "Bob" },
  { id: "user-3", displayName: "Charlie" },
];

// Component source file paths for structural analysis
const componentDir = path.resolve(__dirname, "../../src/components");
const componentFiles = [
  path.join(componentDir, "ui/money-amount.tsx"),
  path.join(componentDir, "ui/money-input.tsx"),
  path.join(componentDir, "ui/submit-button.tsx"),
  path.join(componentDir, "ui/label.tsx"),
  path.join(componentDir, "expense/AddExpenseFlow.tsx"),
  path.join(componentDir, "balance/BalanceSummary.tsx"),
  path.join(componentDir, "balance/SimplifiedPlan.tsx"),
  path.join(componentDir, "settle/SettleUpForm.tsx"),
];

describe("Responsive: no fixed widths causing horizontal scroll at 320px (Req 18.1)", () => {
  it("no component uses hardcoded pixel widths > 320px in className strings", () => {
    // Regex to find inline pixel widths > 320 in className/class attributes
    // Matches patterns like w-[400px], width: 400px, min-width: 400px
    const fixedWidthPattern = /(?:w-\[(\d+)px\]|width:\s*(\d+)px|min-width:\s*(\d+)px)/g;

    for (const filePath of componentFiles) {
      const source = fs.readFileSync(filePath, "utf-8");
      let match: RegExpExecArray | null;

      while ((match = fixedWidthPattern.exec(source)) !== null) {
        const width = parseInt(match[1] || match[2] || match[3] || "0", 10);
        expect(
          width,
          `Fixed width ${width}px found in ${path.basename(filePath)} — would cause horizontal scroll at 320px`,
        ).toBeLessThanOrEqual(320);
      }
    }
  });

  it("components use responsive width classes (w-full, max-w-*, etc.) not fixed widths", () => {
    for (const filePath of componentFiles) {
      const source = fs.readFileSync(filePath, "utf-8");
      // Check that w-full or responsive patterns are used for main containers
      // This is a structural assertion — components should use fluid widths
      const hasFixedLargeWidth = /className="[^"]*\bw-\d{3,}\b/.test(source);
      expect(
        hasFixedLargeWidth,
        `${path.basename(filePath)} uses a fixed large width class`,
      ).toBe(false);
    }
  });
});

describe("Touch targets: interactive elements meet 44×44px minimum (Req 18.2)", () => {
  it("SubmitButton has min-h-touch and min-w-touch classes for 44px minimum", () => {
    render(React.createElement(SubmitButton, null, "Submit"));
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button.className).toContain("min-h-touch");
    expect(button.className).toContain("min-w-touch");
  });

  it("AddExpenseFlow select elements have min-h-touch for touch targets", () => {
    render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );

    // Select elements should have min-h-touch
    const selects = document.querySelectorAll("select");
    selects.forEach((select) => {
      expect(
        select.className,
        `Select "${select.name || select.id}" missing min-h-touch`,
      ).toContain("min-h-touch");
    });
  });

  it("SettleUpForm select elements have min-h-touch for touch targets", () => {
    render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
      }),
    );

    // Select elements should have min-h-touch
    const selects = document.querySelectorAll("select");
    selects.forEach((select) => {
      expect(
        select.className,
        `Select "${select.name || select.id}" missing min-h-touch`,
      ).toContain("min-h-touch");
    });
  });

  it("design tokens include a touch spacing value of 2.75rem (44px)", () => {
    // Verify the design token exists for touch targets
    const tokensSource = fs.readFileSync(
      path.resolve(__dirname, "../../src/design/tokens.ts"),
      "utf-8",
    );
    expect(tokensSource).toContain('touch: "2.75rem"');
  });
});

describe("No hover-only interactions (Req 18.4)", () => {
  it("no component uses onMouseEnter without a corresponding onClick or onKeyDown", () => {
    for (const filePath of componentFiles) {
      const source = fs.readFileSync(filePath, "utf-8");

      // Check for onMouseEnter or onMouseOver usage
      const hasMouseEnter = /onMouseEnter|onMouseOver/.test(source);

      if (hasMouseEnter) {
        // If hover handlers exist, there must also be click/keyboard handlers
        const hasClickOrKey = /onClick|onKeyDown|onKeyUp|onKeyPress/.test(source);
        expect(
          hasClickOrKey,
          `${path.basename(filePath)} has hover-only interaction (onMouseEnter/onMouseOver without click/keyboard handler)`,
        ).toBe(true);
      }
    }
  });

  it("no component uses CSS hover pseudo-class without a focus equivalent", () => {
    for (const filePath of componentFiles) {
      const source = fs.readFileSync(filePath, "utf-8");

      // In Tailwind, hover: classes should be paired with focus: classes
      const hoverClasses = source.match(/hover:[a-z-]+/g) ?? [];
      if (hoverClasses.length > 0) {
        // There should be at least one focus: class in the same component
        const hasFocusClasses = /focus:|focus-visible:/.test(source);
        expect(
          hasFocusClasses,
          `${path.basename(filePath)} has hover styles without corresponding focus styles`,
        ).toBe(true);
      }
    }
  });
});

describe("Responsive structure: components render without errors at any viewport (Req 18.3)", () => {
  it("BalanceSummary renders with empty balances without error", () => {
    const { container } = render(
      React.createElement(BalanceSummary, {
        groupId: "group-1",
        currentUserId: "user-1",
        members: testMembers,
        initialBalances: [],
        currency: "USD",
      }),
    );
    expect(container.textContent).toContain("No expenses recorded yet");
  });

  it("SimplifiedPlan renders with empty transfers without error", () => {
    const { container } = render(
      React.createElement(SimplifiedPlan, {
        groupId: "group-1",
        viewerCurrency: "USD",
        members: testMembers,
        initialTransfers: [],
        transferCurrency: "USD",
      }),
    );
    expect(container.textContent).toContain("No payments needed");
  });

  it("AddExpenseFlow renders all form elements without error", () => {
    render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );

    // All key form elements should be present — use specific IDs to avoid collisions
    expect(document.getElementById("expense-amount")).not.toBeNull();
    expect(document.getElementById("expense-currency")).not.toBeNull();
    expect(document.getElementById("expense-description")).not.toBeNull();
    expect(screen.getByRole("button", { name: /add expense/i })).toBeDefined();
  });

  it("SettleUpForm renders all form elements without error", () => {
    render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
      }),
    );

    expect(document.getElementById("settle-payer")).not.toBeNull();
    expect(document.getElementById("settle-receiver")).not.toBeNull();
    expect(document.getElementById("settle-amount")).not.toBeNull();
    expect(screen.getByRole("button", { name: /record settlement/i })).toBeDefined();
  });
});
