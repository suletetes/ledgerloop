/**
 * Persistence interface and row types for the Ledger Service.
 *
 * This module defines the data-access contract that the Ledger Service depends
 * on. The interface is implemented by:
 *   - An in-memory fake (for property tests and unit tests)
 *   - A real Aurora DSQL adapter (production)
 *
 * ## Row types
 *
 * Row types mirror the DSQL schema columns. Money columns use `number` (safe
 * integers at this layer; the real adapter converts from `bigint` at the
 * boundary). Timestamps are ISO-8601 strings for portability.
 *
 * ## Design references
 *
 * - Persistence interface: design §Components and Interfaces — Persistence
 * - Row shapes: design §Data Models (DDL)
 * - Atomic expense+splits: Req 6.1, 6.11 / INV-1
 * - Idempotent membership: Req 4.2, 13.4
 * - OCC retry: Req 11.2, 11.3, 11.4 / INV-3
 */

import type { Result } from "@/domain/result";
import type { LedgerSnapshot } from "@/domain/balance-engine";

// ─── Row Types ───────────────────────────────────────────────────────────────

/**
 * A row in the `expenses` table.
 */
export interface ExpenseRow {
  id: string;
  groupId: string;
  paidBy: string;
  amountMinor: number;
  currency: string;
  description: string;
  splitType: string;
  createdAt: string;
}

/**
 * A row in the `expense_splits` table.
 */
export interface SplitRow {
  id: string;
  expenseId: string;
  userId: string;
  shareMinor: number;
}

/**
 * A row in the `settlements` table.
 */
export interface SettlementRow {
  id: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
}

/**
 * A row in the `users` table.
 */
export interface UserRow {
  id: string;
  displayName: string;
  email: string;
  homeRegion: string;
  currencyPref: string;
  createdAt: string;
}

/**
 * A row in the `groups` table.
 */
export interface GroupRow {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
}

/**
 * A row in the `group_members` table.
 */
export interface MembershipRow {
  id: string;
  groupId: string;
  userId: string;
  joinedAt: string;
}

// ─── Persistence Interface ───────────────────────────────────────────────────

/**
 * The data-access contract for the Ledger Service.
 *
 * All writes return `Result<string>` where the string is the id of the
 * inserted/affected row. Failures surface as structured `DomainError`s so the
 * orchestration layer can map them to user-safe responses.
 */
export interface Persistence {
  /**
   * Atomically append an expense and its splits in a single transaction.
   * Either all rows land or none (Req 6.1, 6.11 / INV-1).
   */
  insertExpenseWithSplits(
    expense: ExpenseRow,
    splits: SplitRow[],
  ): Promise<Result<string>>;

  /**
   * Append a settlement row.
   */
  insertSettlement(settlement: SettlementRow): Promise<Result<string>>;

  /**
   * Insert a user (reference state).
   */
  insertUser(user: UserRow): Promise<Result<string>>;

  /**
   * Insert a group (reference state).
   */
  insertGroup(group: GroupRow): Promise<Result<string>>;

  /**
   * Insert a membership. Idempotent on `(groupId, userId)`: if the pair already
   * exists, returns ok with the existing row's id (Req 4.2, 13.4).
   */
  insertMembership(m: MembershipRow): Promise<Result<string>>;

  /**
   * Update a user's currency preference.
   */
  updateCurrencyPreference(
    userId: string,
    code: string,
  ): Promise<Result<void>>;

  /**
   * Load the full ledger snapshot for a group (expenses, splits, settlements,
   * member ids). Used by Balance_Engine derivation on the read path.
   */
  loadLedger(groupId: string): Promise<LedgerSnapshot>;

  /**
   * Check whether a membership exists for the given group and user.
   */
  membershipExists(groupId: string, userId: string): Promise<boolean>;

  /**
   * Check whether a group exists.
   */
  groupExists(groupId: string): Promise<boolean>;
}
