/**
 * Real Aurora DSQL Persistence implementation.
 *
 * Implements the Persistence interface against the real DSQL database using
 * the connection module. All writes use application-generated UUIDs
 * (crypto.randomUUID()) because DSQL has no sequences.
 *
 * Design references:
 *   - Persistence interface: design §Components and Interfaces — Persistence
 *   - Atomic expense+splits: Req 6.1, 6.11 / INV-1
 *   - Idempotent membership: Req 4.2, 13.4
 *   - OCC retry: Req 11.2, 11.3, 11.4 / INV-3
 *   - Balance derivation query: design §Data Models
 */

import type { Sql } from "postgres";
import type {
  Persistence,
  ExpenseRow,
  SplitRow,
  SettlementRow,
  UserRow,
  GroupRow,
  MembershipRow,
} from "../persistence";
import type { Result } from "@/domain/result";
import type { LedgerSnapshot } from "@/domain/balance-engine";
import { getDsqlConnection } from "./connection";

/** SQLSTATE code for OCC serialization failure — surfaced so withOccRetry can catch it. */
const OCC_CONFLICT_CODE = "40001";

/**
 * DsqlPersistence — real Aurora DSQL implementation of the Persistence interface.
 *
 * All money columns are stored as BIGINT in the database and converted to/from
 * number at the boundary (safe integers at this layer).
 */
export class DsqlPersistence implements Persistence {
  private sqlPromise: Promise<Sql<Record<string, unknown>>>;

  constructor() {
    this.sqlPromise = getDsqlConnection() as Promise<Sql<Record<string, unknown>>>;
  }

  /**
   * Atomically append an expense and its splits in a single transaction.
   * Either all rows land or none (Req 6.1, 6.11 / INV-1).
   * Surfaces SQLSTATE 40001 errors so withOccRetry can catch them.
   */
  async insertExpenseWithSplits(
    expense: ExpenseRow,
    splits: SplitRow[],
  ): Promise<Result<string>> {
    const sql = await this.sqlPromise;
    try {
      await sql.begin(async (tx: Sql<Record<string, unknown>>) => {
        await tx`
          INSERT INTO expenses (id, group_id, paid_by, amount_minor, currency, description, split_type, created_at)
          VALUES (${expense.id}, ${expense.groupId}, ${expense.paidBy}, ${expense.amountMinor},
                  ${expense.currency}, ${expense.description}, ${expense.splitType}, ${expense.createdAt})
        `;
        for (const split of splits) {
          await tx`
            INSERT INTO expense_splits (id, expense_id, user_id, share_minor)
            VALUES (${split.id}, ${split.expenseId}, ${split.userId}, ${split.shareMinor})
          `;
        }
      });
      return { ok: true, value: expense.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err; // Re-throw so withOccRetry can catch SQLSTATE 40001
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to insert expense: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Append a settlement row. Single INSERT.
   */
  async insertSettlement(settlement: SettlementRow): Promise<Result<string>> {
    const sql = await this.sqlPromise;
    try {
      await sql`
        INSERT INTO settlements (id, group_id, from_user, to_user, amount_minor, currency, created_at)
        VALUES (${settlement.id}, ${settlement.groupId}, ${settlement.fromUser},
                ${settlement.toUser}, ${settlement.amountMinor}, ${settlement.currency},
                ${settlement.createdAt})
      `;
      return { ok: true, value: settlement.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err;
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to insert settlement: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Insert a user (reference state).
   */
  async insertUser(user: UserRow): Promise<Result<string>> {
    const sql = await this.sqlPromise;
    try {
      await sql`
        INSERT INTO users (id, display_name, email, home_region, currency_pref, created_at)
        VALUES (${user.id}, ${user.displayName}, ${user.email},
                ${user.homeRegion}, ${user.currencyPref}, ${user.createdAt})
      `;
      return { ok: true, value: user.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err;
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to insert user: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Insert a group (reference state).
   */
  async insertGroup(group: GroupRow): Promise<Result<string>> {
    const sql = await this.sqlPromise;
    try {
      await sql`
        INSERT INTO groups (id, name, base_currency, created_at)
        VALUES (${group.id}, ${group.name}, ${group.baseCurrency}, ${group.createdAt})
      `;
      return { ok: true, value: group.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err;
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to insert group: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Insert a membership. Idempotent on (group_id, user_id): if the pair already
   * exists, returns ok with the existing row's id (Req 4.2, 13.4).
   */
  async insertMembership(m: MembershipRow): Promise<Result<string>> {
    const sql = await this.sqlPromise;
    try {
      // Check if membership already exists (idempotent on group_id, user_id)
      const existing = await sql`
        SELECT id FROM group_members
        WHERE group_id = ${m.groupId} AND user_id = ${m.userId}
        LIMIT 1
      `;
      if (existing.length > 0 && existing[0] !== undefined) {
        return { ok: true, value: existing[0].id as string };
      }

      await sql`
        INSERT INTO group_members (id, group_id, user_id, joined_at)
        VALUES (${m.id}, ${m.groupId}, ${m.userId}, ${m.joinedAt})
      `;
      return { ok: true, value: m.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err;
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to insert membership: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Update a user's currency preference.
   */
  async updateCurrencyPreference(
    userId: string,
    code: string,
  ): Promise<Result<void>> {
    const sql = await this.sqlPromise;
    try {
      await sql`
        UPDATE users SET currency_pref = ${code} WHERE id = ${userId}
      `;
      return { ok: true, value: undefined };
    } catch (err: unknown) {
      if (isOccConflict(err)) {
        throw err;
      }
      return {
        ok: false,
        error: {
          category: "unavailable",
          message: `Failed to update currency preference: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  /**
   * Load the full ledger snapshot for a group (the balance-derivation query
   * from the design). Uses the big LEFT JOIN query to derive net positions.
   */
  async loadLedger(groupId: string): Promise<LedgerSnapshot> {
    const sql = await this.sqlPromise;

    // Load members
    const memberRows = await sql`
      SELECT user_id FROM group_members WHERE group_id = ${groupId}
    `;
    const members = memberRows.map((r) => r.user_id as string);

    // Load expenses for this group
    const expenseRows = await sql`
      SELECT id, paid_by, amount_minor, currency
      FROM expenses WHERE group_id = ${groupId}
    `;
    const expenses = expenseRows.map((r) => ({
      id: r.id as string,
      paidBy: r.paid_by as string,
      amountMinor: Number(r.amount_minor),
      currency: r.currency as string,
    }));

    // Load splits for expenses in this group
    const splitRows = await sql`
      SELECT s.expense_id, s.user_id, s.share_minor
      FROM expense_splits s
      JOIN expenses e ON e.id = s.expense_id
      WHERE e.group_id = ${groupId}
    `;
    const splits = splitRows.map((r) => ({
      expenseId: r.expense_id as string,
      userId: r.user_id as string,
      shareMinor: Number(r.share_minor),
    }));

    // Load settlements for this group
    const settlementRows = await sql`
      SELECT from_user, to_user, amount_minor, currency
      FROM settlements WHERE group_id = ${groupId}
    `;
    const settlements = settlementRows.map((r) => ({
      fromUser: r.from_user as string,
      toUser: r.to_user as string,
      amountMinor: Number(r.amount_minor),
      currency: r.currency as string,
    }));

    return { members, expenses, splits, settlements };
  }

  /**
   * Check whether a membership exists for the given group and user.
   */
  async membershipExists(groupId: string, userId: string): Promise<boolean> {
    const sql = await this.sqlPromise;
    const result = await sql`
      SELECT EXISTS(
        SELECT 1 FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId}
      ) AS exists
    `;
    return (result[0]?.exists as boolean) ?? false;
  }

  /**
   * Check whether a group exists.
   */
  async groupExists(groupId: string): Promise<boolean> {
    const sql = await this.sqlPromise;
    const result = await sql`
      SELECT EXISTS(
        SELECT 1 FROM groups WHERE id = ${groupId}
      ) AS exists
    `;
    return (result[0]?.exists as boolean) ?? false;
  }
}

/**
 * Check if an error is a DSQL OCC serialization conflict (SQLSTATE 40001).
 */
function isOccConflict(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).code ?? (err as Record<string, unknown>).sqlState;
    return code === OCC_CONFLICT_CODE;
  }
  return false;
}
