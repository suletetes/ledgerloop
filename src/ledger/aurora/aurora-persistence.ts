/**
 * Aurora PostgreSQL Persistence implementation.
 *
 * Identical queries to DsqlPersistence (both are standard PostgreSQL) but
 * uses the Aurora connection module instead of the DSQL signer. The wire
 * protocol, SQL, and OCC error handling are the same.
 *
 * Under SERIALIZABLE isolation, Aurora PostgreSQL returns SQLSTATE 40001 on
 * serialization conflicts, which withOccRetry catches and retries transparently.
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
import { getAuroraConnection } from "./connection";

/** SQLSTATE code for serialization failure (OCC conflict). */
const OCC_CONFLICT_CODE = "40001";

/**
 * AuroraPersistence — real Aurora PostgreSQL implementation of the Persistence interface.
 */
export class AuroraPersistence implements Persistence {
  private sql: Sql<Record<string, unknown>>;

  constructor() {
    this.sql = getAuroraConnection() as Sql<Record<string, unknown>>;
  }

  async insertExpenseWithSplits(
    expense: ExpenseRow,
    splits: SplitRow[],
  ): Promise<Result<string>> {
    try {
      await this.sql.begin(async (tx: Sql<Record<string, unknown>>) => {
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
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to insert expense: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async insertSettlement(settlement: SettlementRow): Promise<Result<string>> {
    try {
      await this.sql`
        INSERT INTO settlements (id, group_id, from_user, to_user, amount_minor, currency, created_at)
        VALUES (${settlement.id}, ${settlement.groupId}, ${settlement.fromUser},
                ${settlement.toUser}, ${settlement.amountMinor}, ${settlement.currency},
                ${settlement.createdAt})
      `;
      return { ok: true, value: settlement.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to insert settlement: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async insertUser(user: UserRow): Promise<Result<string>> {
    try {
      await this.sql`
        INSERT INTO users (id, display_name, email, home_region, currency_pref, created_at)
        VALUES (${user.id}, ${user.displayName}, ${user.email},
                ${user.homeRegion}, ${user.currencyPref}, ${user.createdAt})
      `;
      return { ok: true, value: user.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to insert user: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async insertGroup(group: GroupRow): Promise<Result<string>> {
    try {
      await this.sql`
        INSERT INTO groups (id, name, base_currency, created_at)
        VALUES (${group.id}, ${group.name}, ${group.baseCurrency}, ${group.createdAt})
      `;
      return { ok: true, value: group.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to insert group: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async insertMembership(m: MembershipRow): Promise<Result<string>> {
    try {
      const existing = await this.sql`
        SELECT id FROM group_members
        WHERE group_id = ${m.groupId} AND user_id = ${m.userId}
        LIMIT 1
      `;
      if (existing.length > 0 && existing[0] !== undefined) {
        return { ok: true, value: existing[0].id as string };
      }
      await this.sql`
        INSERT INTO group_members (id, group_id, user_id, joined_at)
        VALUES (${m.id}, ${m.groupId}, ${m.userId}, ${m.joinedAt})
      `;
      return { ok: true, value: m.id };
    } catch (err: unknown) {
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to insert membership: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async updateCurrencyPreference(userId: string, code: string): Promise<Result<void>> {
    try {
      await this.sql`UPDATE users SET currency_pref = ${code} WHERE id = ${userId}`;
      return { ok: true, value: undefined };
    } catch (err: unknown) {
      if (isOccConflict(err)) throw err;
      return {
        ok: false,
        error: { category: "unavailable", message: `Failed to update currency preference: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  async loadLedger(groupId: string): Promise<LedgerSnapshot> {
    const memberRows = await this.sql`
      SELECT user_id FROM group_members WHERE group_id = ${groupId}
    `;
    const members = memberRows.map((r) => r.user_id as string);

    const expenseRows = await this.sql`
      SELECT id, paid_by, amount_minor, currency FROM expenses WHERE group_id = ${groupId}
    `;
    const expenses = expenseRows.map((r) => ({
      id: r.id as string,
      paidBy: r.paid_by as string,
      amountMinor: Number(r.amount_minor),
      currency: r.currency as string,
    }));

    const splitRows = await this.sql`
      SELECT s.expense_id, s.user_id, s.share_minor
      FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
      WHERE e.group_id = ${groupId}
    `;
    const splits = splitRows.map((r) => ({
      expenseId: r.expense_id as string,
      userId: r.user_id as string,
      shareMinor: Number(r.share_minor),
    }));

    const settlementRows = await this.sql`
      SELECT from_user, to_user, amount_minor, currency FROM settlements WHERE group_id = ${groupId}
    `;
    const settlements = settlementRows.map((r) => ({
      fromUser: r.from_user as string,
      toUser: r.to_user as string,
      amountMinor: Number(r.amount_minor),
      currency: r.currency as string,
    }));

    return { members, expenses, splits, settlements };
  }

  async membershipExists(groupId: string, userId: string): Promise<boolean> {
    const result = await this.sql`
      SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}) AS exists
    `;
    return (result[0]?.exists as boolean) ?? false;
  }

  async groupExists(groupId: string): Promise<boolean> {
    const result = await this.sql`
      SELECT EXISTS(SELECT 1 FROM groups WHERE id = ${groupId}) AS exists
    `;
    return (result[0]?.exists as boolean) ?? false;
  }

  // ─── Read helpers (used by UI pages) ───────────────────────────────────────

  async getGroupsForUser(userId: string) {
    const rows = await this.sql`
      SELECT g.id, g.name, g.base_currency,
        (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
      FROM groups g JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ${userId} ORDER BY g.created_at ASC
    `;
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      baseCurrency: r.base_currency as string,
      memberCount: Number(r.member_count),
    }));
  }

  async getGroup(groupId: string) {
    const rows = await this.sql`SELECT id, name, base_currency FROM groups WHERE id = ${groupId} LIMIT 1`;
    const r = rows[0];
    if (!r) return null;
    return { id: r.id as string, name: r.name as string, baseCurrency: r.base_currency as string };
  }

  async getGroupMembers(groupId: string) {
    const rows = await this.sql`
      SELECT gm.user_id, u.display_name FROM group_members gm
      LEFT JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ${groupId} ORDER BY gm.joined_at ASC
    `;
    return rows.map((r) => ({
      userId: r.user_id as string,
      displayName: (r.display_name as string | null) ?? "Unknown",
    }));
  }

  async getUser(userId: string): Promise<UserRow | null> {
    const rows = await this.sql`
      SELECT id, display_name, email, home_region, currency_pref, created_at
      FROM users WHERE id = ${userId} LIMIT 1
    `;
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id as string,
      displayName: r.display_name as string,
      email: r.email as string,
      homeRegion: r.home_region as string,
      currencyPref: r.currency_pref as string,
      createdAt: String(r.created_at),
    };
  }
}

function isOccConflict(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).code ?? (err as Record<string, unknown>).sqlState;
    return code === OCC_CONFLICT_CODE;
  }
  return false;
}
