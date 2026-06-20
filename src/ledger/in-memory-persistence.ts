/**
 * In-memory fake implementation of the {@link Persistence} interface.
 *
 * This fake is designed for property tests and unit tests. It models:
 *   - Atomic append for `insertExpenseWithSplits` (all rows land or none).
 *   - Idempotent membership on `(groupId, userId)` (Req 4.2, 13.4).
 *   - An OCC conflict injection hook (`injectOccConflict`) that causes the next
 *     N write operations to throw an error with code "40001", simulating
 *     SQLSTATE 40001 for concurrency tests (INV-3, tasks 9.3, 12.10).
 *
 * Storage is simple arrays/maps — no real database, no I/O.
 */

import type { LedgerSnapshot } from "@/domain/balance-engine";
import type { Result } from "@/domain/result";
import { ok } from "@/domain/result";
import type {
  Persistence,
  ExpenseRow,
  SplitRow,
  SettlementRow,
  UserRow,
  GroupRow,
  MembershipRow,
} from "./persistence";

/**
 * An error that simulates a DSQL OCC conflict (SQLSTATE 40001).
 */
export class OccConflictError extends Error {
  public readonly code = "40001";

  constructor() {
    super("serialization_failure: simulated OCC conflict (SQLSTATE 40001)");
    this.name = "OccConflictError";
  }
}

/**
 * In-memory fake of the Persistence interface.
 *
 * All data lives in plain arrays/maps. The fake is synchronous under the hood
 * but returns Promises to match the interface contract.
 */
export class InMemoryPersistence implements Persistence {
  // ─── Storage ─────────────────────────────────────────────────────────────

  private readonly expenses: ExpenseRow[] = [];
  private readonly splits: SplitRow[] = [];
  private readonly settlements: SettlementRow[] = [];
  private readonly users: UserRow[] = [];
  private readonly groups: GroupRow[] = [];
  private readonly memberships: MembershipRow[] = [];

  // ─── OCC Conflict Injection ──────────────────────────────────────────────

  private occConflictsRemaining = 0;

  /**
   * Cause the next `count` write operations to throw an {@link OccConflictError}
   * before persisting anything. This lets property tests for `withOccRetry`
   * (task 9.3) and no-double-counting (task 12.10) inject conflicts cheaply.
   */
  injectOccConflict(count: number): void {
    this.occConflictsRemaining = count;
  }

  /**
   * If there are remaining injected conflicts, decrement the counter and throw.
   * Called at the top of every write method.
   */
  private throwIfOccInjected(): void {
    if (this.occConflictsRemaining > 0) {
      this.occConflictsRemaining -= 1;
      throw new OccConflictError();
    }
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  async insertExpenseWithSplits(
    expense: ExpenseRow,
    splits: SplitRow[],
  ): Promise<Result<string>> {
    this.throwIfOccInjected();

    // Atomic: append all at once (no partial state if an error were to occur
    // between pushes — in this fake the only error source is the OCC hook
    // above, which fires before any mutation).
    this.expenses.push(expense);
    for (const split of splits) {
      this.splits.push(split);
    }

    return ok(expense.id);
  }

  async insertSettlement(settlement: SettlementRow): Promise<Result<string>> {
    this.throwIfOccInjected();
    this.settlements.push(settlement);
    return ok(settlement.id);
  }

  async insertUser(user: UserRow): Promise<Result<string>> {
    this.throwIfOccInjected();
    this.users.push(user);
    return ok(user.id);
  }

  async insertGroup(group: GroupRow): Promise<Result<string>> {
    this.throwIfOccInjected();
    this.groups.push(group);
    return ok(group.id);
  }

  /**
   * Idempotent on `(groupId, userId)`: if the pair already exists, return ok
   * with the existing row's id without inserting a duplicate (Req 4.2, 13.4).
   */
  async insertMembership(m: MembershipRow): Promise<Result<string>> {
    this.throwIfOccInjected();

    const existing = this.memberships.find(
      (row) => row.groupId === m.groupId && row.userId === m.userId,
    );
    if (existing) {
      return ok(existing.id);
    }

    this.memberships.push(m);
    return ok(m.id);
  }

  async updateCurrencyPreference(
    userId: string,
    code: string,
  ): Promise<Result<void>> {
    this.throwIfOccInjected();

    const user = this.users.find((u) => u.id === userId);
    if (user) {
      user.currencyPref = code;
    }
    return ok(undefined);
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  async loadLedger(groupId: string): Promise<LedgerSnapshot> {
    const members = this.memberships
      .filter((m) => m.groupId === groupId)
      .map((m) => m.userId);

    const groupExpenses = this.expenses.filter((e) => e.groupId === groupId);

    const expenseIds = new Set(groupExpenses.map((e) => e.id));
    const groupSplits = this.splits.filter((s) => expenseIds.has(s.expenseId));

    const groupSettlements = this.settlements.filter(
      (s) => s.groupId === groupId,
    );

    return {
      members,
      expenses: groupExpenses.map((e) => ({
        id: e.id,
        paidBy: e.paidBy,
        amountMinor: e.amountMinor,
        currency: e.currency,
      })),
      splits: groupSplits.map((s) => ({
        expenseId: s.expenseId,
        userId: s.userId,
        shareMinor: s.shareMinor,
      })),
      settlements: groupSettlements.map((s) => ({
        fromUser: s.fromUser,
        toUser: s.toUser,
        amountMinor: s.amountMinor,
        currency: s.currency,
      })),
    };
  }

  async membershipExists(groupId: string, userId: string): Promise<boolean> {
    return this.memberships.some(
      (m) => m.groupId === groupId && m.userId === userId,
    );
  }

  async groupExists(groupId: string): Promise<boolean> {
    return this.groups.some((g) => g.id === groupId);
  }

  // ─── Query helpers (used by UI data fetching) ─────────────────────────────

  /** Get all groups a user belongs to. */
  async getGroupsForUser(
    userId: string,
  ): Promise<{ id: string; name: string; baseCurrency: string; memberCount: number }[]> {
    const userGroupIds = this.memberships
      .filter((m) => m.userId === userId)
      .map((m) => m.groupId);

    return userGroupIds.map((gid) => {
      const group = this.groups.find((g) => g.id === gid);
      const memberCount = this.memberships.filter((m) => m.groupId === gid).length;
      return {
        id: group?.id ?? gid,
        name: group?.name ?? "Unknown",
        baseCurrency: group?.baseCurrency ?? "USD",
        memberCount,
      };
    });
  }

  /** Get group details by id. */
  async getGroup(
    groupId: string,
  ): Promise<{ id: string; name: string; baseCurrency: string } | null> {
    const g = this.groups.find((g) => g.id === groupId);
    return g ? { id: g.id, name: g.name, baseCurrency: g.baseCurrency } : null;
  }

  /** Get members of a group with display names. */
  async getGroupMembers(
    groupId: string,
  ): Promise<{ userId: string; displayName: string }[]> {
    const memberUserIds = this.memberships
      .filter((m) => m.groupId === groupId)
      .map((m) => m.userId);

    return memberUserIds.map((uid) => {
      const user = this.users.find((u) => u.id === uid);
      return { userId: uid, displayName: user?.displayName ?? "Unknown" };
    });
  }

  /** Get user by id. */
  async getUser(userId: string): Promise<UserRow | null> {
    return this.users.find((u) => u.id === userId) ?? null;
  }
}
