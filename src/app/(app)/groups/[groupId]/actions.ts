"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getSession } from "../../../../lib/auth";
import { getPersistence } from "../../../../lib/persistence-factory";
import { addExpense } from "../../../../ledger/orchestration";
import { recordSettlement } from "../../../../ledger/orchestration";
import type { SplitType } from "../../../../domain/types";

export interface AddExpenseInput {
  groupId: string;
  amountMinor: number;
  currency: string;
  description: string;
  paidBy: string;
  splitType: SplitType;
  participants: string[];
  percents?: number[];
  exactShares?: number[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export async function addExpenseAction(input: AddExpenseInput): Promise<ActionResult> {
  const persistence = getPersistence();

  // Get caller from session, fallback to recent user
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  let callerId = getSession(token);

  if (!callerId && "getRecentUserIdAsync" in persistence) {
    callerId = await (persistence as { getRecentUserIdAsync: () => Promise<string | null> }).getRecentUserIdAsync();
  }

  if (!callerId) {
    return { ok: false, error: "You must be signed in to add an expense." };
  }

  const result = await addExpense(persistence, callerId, {
    groupId: input.groupId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    description: input.description,
    paidBy: input.paidBy,
    splitType: input.splitType,
    participants: input.participants,
    percents: input.percents,
    exactShares: input.exactShares,
  });

  if (!result.ok) {
    // Retry once on connection timeout (Aurora cold start)
    if (result.error.message.includes("CONNECT_TIMEOUT")) {
      const retry = await addExpense(persistence, callerId, {
        groupId: input.groupId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: input.description,
        paidBy: input.paidBy,
        splitType: input.splitType,
        participants: input.participants,
        percents: input.percents,
        exactShares: input.exactShares,
      });
      if (!retry.ok) return { ok: false, error: retry.error.message };
      return { ok: true, id: retry.value };
    }
    return { ok: false, error: result.error.message };
  }

  return { ok: true, id: result.value };
}

export interface SettleInput {
  groupId: string;
  fromUser: string;
  toUser: string;
  amountMinor: number;
  currency: string;
}

export async function settleAction(input: SettleInput): Promise<ActionResult> {
  const persistence = getPersistence();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  let callerId = getSession(token);

  if (!callerId && "getRecentUserIdAsync" in persistence) {
    callerId = await (persistence as { getRecentUserIdAsync: () => Promise<string | null> }).getRecentUserIdAsync();
  }

  if (!callerId) {
    return { ok: false, error: "You must be signed in to record a settlement." };
  }

  const result = await recordSettlement(persistence, callerId, {
    groupId: input.groupId,
    fromUser: input.fromUser,
    toUser: input.toUser,
    amountMinor: input.amountMinor,
    currency: input.currency,
  });

  if (!result.ok) {
    if (result.error.message.includes("CONNECT_TIMEOUT")) {
      const retry = await recordSettlement(persistence, callerId, {
        groupId: input.groupId,
        fromUser: input.fromUser,
        toUser: input.toUser,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
      if (!retry.ok) return { ok: false, error: retry.error.message };
      return { ok: true, id: retry.value };
    }
    return { ok: false, error: result.error.message };
  }

  return { ok: true, id: result.value };
}
