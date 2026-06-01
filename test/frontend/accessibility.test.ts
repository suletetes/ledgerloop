// @vitest-environment jsdom

/**
 * Task 19.1 — Automated accessibility checks for all core flows (Req 17.1).
 *
 * Uses axe-core via jest-axe to run automated WCAG 2.1 AA checks on each
 * rendered component. Components are rendered with minimal valid props in a
 * jsdom environment and checked for violations.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { configureAxe, toHaveNoViolations } from "jest-axe";
import React from "react";

import { MoneyAmount } from "@/components/ui/money-amount";
import { MoneyInput } from "@/components/ui/money-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { AddExpenseFlow } from "@/components/expense/AddExpenseFlow";
import { BalanceSummary } from "@/components/balance/BalanceSummary";
import { SimplifiedPlan } from "@/components/balance/SimplifiedPlan";
import { SettleUpForm } from "@/components/settle/SettleUpForm";

expect.extend(toHaveNoViolations);

const axe = configureAxe({
  rules: {
    // Disable color-contrast in jsdom since computed styles aren't reliable
    "color-contrast": { enabled: false },
    // Disable region rule — components are tested in isolation, not in full page
    region: { enabled: false },
  },
});

const testMembers = [
  { id: "user-1", displayName: "Alice" },
  { id: "user-2", displayName: "Bob" },
  { id: "user-3", displayName: "Charlie" },
];

describe("Accessibility: axe-core checks on core components (Req 17.1)", () => {
  it("MoneyAmount has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(MoneyAmount, {
        amountMinor: 1234,
        currency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("MoneyAmount with cross-currency conversion has no violations", async () => {
    const { container } = render(
      React.createElement(MoneyAmount, {
        amountMinor: 1234,
        currency: "USD",
        viewerCurrency: "EUR",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("MoneyInput has no accessibility violations", async () => {
    const { container } = render(
      React.createElement("div", null,
        React.createElement("label", { htmlFor: "test-money" }, "Amount"),
        React.createElement(MoneyInput, {
          id: "test-money",
          currency: "USD",
          onChange: () => {},
        }),
      ),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Label has no accessibility violations", async () => {
    const { container } = render(
      React.createElement("div", null,
        React.createElement(Label, { htmlFor: "test-input" }, "Test Label"),
        React.createElement("input", { id: "test-input", type: "text" }),
      ),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SubmitButton has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(SubmitButton, null, "Submit"),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SubmitButton in pending state has no violations", async () => {
    const { container } = render(
      React.createElement(SubmitButton, { pending: true, children: "Submit" }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("AddExpenseFlow has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(AddExpenseFlow, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        baseCurrency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("BalanceSummary has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(BalanceSummary, {
        groupId: "group-1",
        currentUserId: "user-1",
        members: testMembers,
        initialBalances: [
          { userId: "user-1", netMinor: 500 },
          { userId: "user-2", netMinor: -300 },
          { userId: "user-3", netMinor: -200 },
        ],
        currency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("BalanceSummary with all-settled state has no violations", async () => {
    const { container } = render(
      React.createElement(BalanceSummary, {
        groupId: "group-1",
        currentUserId: "user-1",
        members: testMembers,
        initialBalances: [
          { userId: "user-1", netMinor: 0 },
          { userId: "user-2", netMinor: 0 },
          { userId: "user-3", netMinor: 0 },
        ],
        currency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SimplifiedPlan has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(SimplifiedPlan, {
        groupId: "group-1",
        viewerCurrency: "USD",
        members: testMembers,
        initialTransfers: [
          { from: "user-2", to: "user-1", amountMinor: 300 },
          { from: "user-3", to: "user-1", amountMinor: 200 },
        ],
        transferCurrency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SimplifiedPlan with empty transfers has no violations", async () => {
    const { container } = render(
      React.createElement(SimplifiedPlan, {
        groupId: "group-1",
        viewerCurrency: "USD",
        members: testMembers,
        initialTransfers: [],
        transferCurrency: "USD",
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SettleUpForm has no accessibility violations", async () => {
    const { container } = render(
      React.createElement(SettleUpForm, {
        groupId: "group-1",
        members: testMembers,
        currentUserId: "user-1",
        currency: "USD",
        defaultPayer: "user-2",
        defaultReceiver: "user-1",
        defaultAmountMinor: 300,
      }),
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
