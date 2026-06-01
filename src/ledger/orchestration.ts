/**
 * Ledger Service write orchestration — addExpense, recordSettlement,
 * correctExpense.
 *
 * Each function composes the pure domain core (validation, split calculation,
 * settlement validation) with the Auth_Guard and Persistence interface to
 * implement the full write path. The ordering is strict:
 *
 *   1. Field validation (reject malformed input before any I/O)
 *   2. Authorization / referential-integrity (Auth_Guard)
 *   3. Domain logic (Split_Calculator / Settlement_Validator)
 *   4. Atomic persistence inside withOccRetry
 *
 * Any failure at steps 1–3 short-circuits with a structured Result error and
 * leaves the ledger unchanged. Step 4 uses OCC retry so transient DSQL
 * conflicts resolve automatically; exhausted retries surface as
 * `{ category: "conflict_exhausted" }`.
 *
 * Design references:
 * - Write path sequence: design §Architecture — Request lifecycles
 * - Tasks 12.1, 12.5, 12.7
 */

import { isValidCurrency } from "@/domain/money";
import { err, type Result } from "@/domain/result";
import { equalSplit, percentSplit, exactSplit } from "@/domain/split-calculator";
import { SettlementValidator } from "@/domain/settlement-validator";
import type { ExpenseInput, SettlementInput, Split } from "@/domain/types";
import { AuthGuard } from "./auth-guard";
import { OccExhaustedError, withOccRetry } from "./occ-retry";
import type { Persistence, ExpenseRow, SplitRow, SettlementRow } from "./persistence";

// ─── Constants ─────────────────────────────────────────────────────────────

/** The valid split types accepted by addExpense. */
const VALID_SPLIT_TYPES = new Set(["equal", "percent", "exact"]);

/**
 * Maximum expense amount: 2^63 − 1 (the BIGINT upper bound). At the TypeScript
 * layer we use Number.MAX_SAFE_INTEGER as the practical cap since amounts are
 * `number` in the domain core. The task spec says 1..9,223,372,036,854,775,807
 * but Number.MAX_SAFE_INTEGER (2^53 − 1) is the largest integer `number` can
 * represent exactly; values beyond that are handled at the persistence boundary.
 */
const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

// ─── addExpense (Task 12.1) ────────────────────────────────────────────────

/**
 * Add an expense to a group's append-only ledger.
 *
 * Orchestration order:
 *   1. Field validation (amount, currency, description, splitType, participants)
 *   2. Auth_Guard: caller is a group member + all participants are members
 *   3. Split_Calculator: compute per-member shares
 *   4. Atomic insertExpenseWithSplits inside withOccRetry
 *
 * @param persistence - The data-access implementation.
 * @param callerId   - The authenticated caller's member id.
 * @param input      - The expense input to validate and record.
 * @returns ok(expenseId) on success, or a structured DomainError.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 6.10, 6.11, 13.1
 */
export async function addExpense(
  persistence: Persistence,
  callerId: string,
  input: ExpenseInput,
): Promise<Result<string>> {
  // ── 1. Field validation ──────────────────────────────────────────────────

  // Amount: positive integer 1..MAX_AMOUNT (Req 6.2, 6.9)
  if (
    input.amountMinor === undefined ||
    input.amountMinor === null ||
    !Number.isInteger(input.amountMinor) ||
    input.amountMinor < 1 ||
    input.amountMinor > MAX_AMOUNT
  ) {
    return err("validation", "Amount must be a positive integer in minor units.", {
      field: "amountMinor",
    });
  }

  // Currency: valid ISO-4217 (Req 6.3)
  if (!input.currency || !isValidCurrency(input.currency)) {
    return err("validation", "Currency is not a valid ISO-4217 code.", {
      field: "currency",
    });
  }

  // Description: present, non-whitespace, ≤500 chars (Req 6.5)
  if (
    !input.description ||
    typeof input.description !== "string" ||
    input.description.trim() === "" ||
    input.description.length > 500
  ) {
    return err(
      "validation",
      "Description must be present, non-whitespace, and at most 500 characters.",
      { field: "description" },
    );
  }

  // Split type: must be one of the valid types (Req 6.4)
  if (!input.splitType || !VALID_SPLIT_TYPES.has(input.splitType)) {
    return err("validation", "Split type must be 'equal', 'percent', or 'exact'.", {
      field: "splitType",
    });
  }

  // Participants: non-empty array (Req 6.4, 6.10)
  if (
    !input.participants ||
    !Array.isArray(input.participants) ||
    input.participants.length === 0
  ) {
    return err("validation", "At least one participant is required.", {
      field: "participants",
    });
  }

  // ── 2. Authorization / referential-integrity ─────────────────────────────

  const guard = new AuthGuard(persistence);

  // Caller must be a group member (Req 5.1)
  const callerCheck = await guard.requireGroupMembership(callerId, input.groupId);
  if (!callerCheck.ok) {
    return callerCheck as Result<string>;
  }

  // Payer + all participants must be group members (Req 5.3, 5.5, 13.1)
  const participantsCheck = await guard.requireExpenseParticipantsAreMembers(
    input.groupId,
    input.paidBy,
    input.participants,
  );
  if (!participantsCheck.ok) {
    return participantsCheck as Result<string>;
  }

  // ── 3. Compute splits ────────────────────────────────────────────────────

  let splits: Split[];

  if (input.splitType === "equal") {
    splits = equalSplit(input.amountMinor, input.participants);
  } else if (input.splitType === "percent") {
    if (!input.percents || !Array.isArray(input.percents)) {
      return err("validation", "Percentages are required for a percent split.", {
        field: "percents",
      });
    }
    const percentResult = percentSplit(
      input.amountMinor,
      input.participants,
      input.percents,
    );
    if (!percentResult.ok) {
      return percentResult as Result<string>;
    }
    splits = percentResult.value;
  } else {
    // exact
    if (!input.exactShares || !Array.isArray(input.exactShares)) {
      return err("validation", "Exact shares are required for an exact split.", {
        field: "exactShares",
      });
    }
    const exactResult = exactSplit(
      input.amountMinor,
      input.participants,
      input.exactShares,
    );
    if (!exactResult.ok) {
      return exactResult as Result<string>;
    }
    splits = exactResult.value;
  }

  // ── 4. Atomic insert inside OCC retry ────────────────────────────────────

  const expenseId = crypto.randomUUID();
  const now = new Date().toISOString();

  const expenseRow: ExpenseRow = {
    id: expenseId,
    groupId: input.groupId,
    paidBy: input.paidBy,
    amountMinor: input.amountMinor,
    currency: input.currency,
    description: input.description,
    splitType: input.splitType,
    createdAt: now,
  };

  const splitRows: SplitRow[] = splits.map((s) => ({
    id: crypto.randomUUID(),
    expenseId,
    userId: s.userId,
    shareMinor: s.shareMinor,
  }));

  try {
    const insertResult = await withOccRetry(() =>
      persistence.insertExpenseWithSplits(expenseRow, splitRows),
    );
    return insertResult;
  } catch (e: unknown) {
    if (e instanceof OccExhaustedError) {
      return err("conflict_exhausted", "Write conflict; please retry.");
    }
    throw e;
  }
}

// ─── recordSettlement (Task 12.5) ──────────────────────────────────────────

/**
 * Record a settlement (one member paying another to reduce a debt).
 *
 * Orchestration order:
 *   1. Required-field validation
 *   2. Auth_Guard: payer and receiver are group members
 *   3. Settlement_Validator: structural + INV-5 cap check
 *   4. Atomic insertSettlement inside withOccRetry
 *
 * @param persistence - The data-access implementation.
 * @param callerId   - The authenticated caller's member id.
 * @param input      - The settlement input to validate and record.
 * @returns ok(settlementId) on success, or a structured DomainError.
 *
 * Requirements: 8.1, 8.4, 8.5, 8.9, 13.2
 */
export async function recordSettlement(
  persistence: Persistence,
  callerId: string,
  input: SettlementInput,
): Promise<Result<string>> {
  // ── 1. Required-field validation ─────────────────────────────────────────

  if (!input.groupId || (typeof input.groupId === "string" && input.groupId.trim() === "")) {
    return err("validation", "The group is required.", { field: "groupId" });
  }
  if (!input.fromUser || (typeof input.fromUser === "string" && input.fromUser.trim() === "")) {
    return err("validation", "The paying member is required.", { field: "fromUser" });
  }
  if (!input.toUser || (typeof input.toUser === "string" && input.toUser.trim() === "")) {
    return err("validation", "The receiving member is required.", { field: "toUser" });
  }
  if (
    input.amountMinor === undefined ||
    input.amountMinor === null ||
    !Number.isInteger(input.amountMinor) ||
    input.amountMinor <= 0
  ) {
    return err(
      "validation",
      "Settlement amount must be a positive integer in minor units.",
      { field: "amountMinor" },
    );
  }
  if (!input.currency || !isValidCurrency(input.currency)) {
    return err("validation", "Currency is not a valid ISO-4217 code.", {
      field: "currency",
    });
  }

  // ── 2. Authorization ─────────────────────────────────────────────────────

  const guard = new AuthGuard(persistence);

  // Caller must be a group member
  const callerCheck = await guard.requireGroupMembership(callerId, input.groupId);
  if (!callerCheck.ok) {
    return callerCheck as Result<string>;
  }

  // Payer and receiver must be group members (Req 5.4, 13.2)
  const partiesCheck = await guard.requireSettlementPartiesAreMembers(
    input.groupId,
    input.fromUser,
    input.toUser,
  );
  if (!partiesCheck.ok) {
    return partiesCheck as Result<string>;
  }

  // ── 3. Settlement_Validator (structural + INV-5 cap) ─────────────────────

  const snapshot = await persistence.loadLedger(input.groupId);
  const validationResult = SettlementValidator.validate(snapshot, input);
  if (!validationResult.ok) {
    return validationResult as Result<string>;
  }

  // ── 4. Atomic insert inside OCC retry ────────────────────────────────────

  const settlementId = crypto.randomUUID();
  const now = new Date().toISOString();

  const settlementRow: SettlementRow = {
    id: settlementId,
    groupId: input.groupId,
    fromUser: input.fromUser,
    toUser: input.toUser,
    amountMinor: input.amountMinor,
    currency: input.currency,
    createdAt: now,
  };

  try {
    const insertResult = await withOccRetry(() =>
      persistence.insertSettlement(settlementRow),
    );
    return insertResult;
  } catch (e: unknown) {
    if (e instanceof OccExhaustedError) {
      return err("conflict_exhausted", "Write conflict; please retry.");
    }
    throw e;
  }
}

// ─── correctExpense (Task 12.7) ────────────────────────────────────────────

/**
 * Correct an expense by appending a reversing expense that negates the
 * original's splits. The original expense and its splits are never modified
 * (append-only ledger, Req 6.6, 6.7).
 *
 * The reversal is a new expense with:
 *   - The same groupId, paidBy, currency, and splitType as the original
 *   - A description indicating it is a reversal
 *   - The same amountMinor (the reversal's splits carry negated shareMinor
 *     values so the net effect on each participant is zero)
 *
 * @param persistence       - The data-access implementation.
 * @param callerId          - The authenticated caller's member id.
 * @param originalExpenseId - The id of the expense to reverse.
 * @param groupId           - The group the expense belongs to.
 * @returns ok(reversalExpenseId) on success, or a structured DomainError.
 *
 * Requirements: 6.6, 6.7
 */
export async function correctExpense(
  persistence: Persistence,
  callerId: string,
  originalExpenseId: string,
  groupId: string,
): Promise<Result<string>> {
  // Authorization: caller must be a group member
  const guard = new AuthGuard(persistence);
  const callerCheck = await guard.requireGroupMembership(callerId, groupId);
  if (!callerCheck.ok) {
    return callerCheck as Result<string>;
  }

  // Load the ledger to find the original expense and its splits
  const snapshot = await persistence.loadLedger(groupId);

  const originalExpense = snapshot.expenses.find((e) => e.id === originalExpenseId);
  if (!originalExpense) {
    return err("not_found", "Expense not found.");
  }

  const originalSplits = snapshot.splits.filter(
    (s) => s.expenseId === originalExpenseId,
  );
  if (originalSplits.length === 0) {
    return err("not_found", "Expense splits not found.");
  }

  // Create the reversing expense: same amount, negated splits
  const reversalId = crypto.randomUUID();
  const now = new Date().toISOString();

  const reversalExpenseRow: ExpenseRow = {
    id: reversalId,
    groupId,
    paidBy: originalExpense.paidBy,
    amountMinor: -originalExpense.amountMinor,
    currency: originalExpense.currency,
    description: `Reversal of expense ${originalExpenseId}`,
    splitType: "exact",
    createdAt: now,
  };

  const reversalSplitRows: SplitRow[] = originalSplits.map((s) => ({
    id: crypto.randomUUID(),
    expenseId: reversalId,
    userId: s.userId,
    shareMinor: -s.shareMinor,
  }));

  try {
    const insertResult = await withOccRetry(() =>
      persistence.insertExpenseWithSplits(reversalExpenseRow, reversalSplitRows),
    );
    return insertResult;
  } catch (e: unknown) {
    if (e instanceof OccExhaustedError) {
      return err("conflict_exhausted", "Write conflict; please retry.");
    }
    throw e;
  }
}
