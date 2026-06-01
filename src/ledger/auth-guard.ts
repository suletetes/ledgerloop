/**
 * Auth_Guard — membership authorization checks for group-scoped operations.
 *
 * Confirms the caller (and, for writes, every member referenced by the
 * operation) holds a membership in the target group before any group-scoped
 * read or write proceeds. This is the single chokepoint that satisfies Req 5
 * and the authorization half of INV-6 (Req 13).
 *
 * Design references:
 * - Auth_Guard interface: design §Components and Interfaces — Auth_Guard
 * - Req 5.1, 5.2, 5.3, 5.4, 5.5, 13.3
 *
 * Behavior:
 * - A failed membership check returns `{ category: "authorization" }` and
 *   never includes any group contents (Req 5.2, 21.4).
 * - For expenses, if any assigned member is not a group member, the *entire*
 *   operation is blocked — no expense and no splits are written (Req 5.5).
 * - Group-existence failures surface as `{ category: "not_found" }` (Req 4.3, 13.3).
 */

import type { Result } from "@/domain/result";
import { ok, err } from "@/domain/result";
import type { Persistence } from "./persistence";

/**
 * Auth_Guard implementation that uses the Persistence interface for
 * membership and group-existence checks.
 *
 * Accepts a Persistence instance via constructor injection so it can be
 * tested against the in-memory fake.
 */
export class AuthGuard {
  private readonly persistence: Persistence;

  constructor(persistence: Persistence) {
    this.persistence = persistence;
  }

  /**
   * Gate every group-scoped read or write (Req 5.1, 5.2).
   *
   * Checks that the group exists, then that the caller is a member.
   * - If the group does not exist → `{ category: "not_found" }` (Req 13.3).
   * - If the caller is not a member → `{ category: "authorization" }` with no
   *   group contents disclosed (Req 5.2, 21.4).
   */
  async requireGroupMembership(
    callerId: string,
    groupId: string,
  ): Promise<Result<void>> {
    const groupFound = await this.persistence.groupExists(groupId);
    if (!groupFound) {
      return err("not_found", "Group does not exist");
    }

    const isMember = await this.persistence.membershipExists(groupId, callerId);
    if (!isMember) {
      return err("authorization", "Not authorized to access this group");
    }

    return ok(undefined);
  }

  /**
   * Confirm payer AND every assigned split member are group members (Req 5.3, 5.5, 13.1).
   *
   * Checks:
   * 1. Group exists → else `not_found`.
   * 2. `paidBy` is a member → else `authorization`.
   * 3. Every participant is a member → else `authorization`.
   *
   * If any assigned member is not a group member, the entire operation is
   * blocked (Req 5.5). Messages are PII-free and do not disclose group
   * contents (Req 5.2, 21.4).
   */
  async requireExpenseParticipantsAreMembers(
    groupId: string,
    paidBy: string,
    participants: string[],
  ): Promise<Result<void>> {
    const groupFound = await this.persistence.groupExists(groupId);
    if (!groupFound) {
      return err("not_found", "Group does not exist");
    }

    const payerIsMember = await this.persistence.membershipExists(
      groupId,
      paidBy,
    );
    if (!payerIsMember) {
      return err("authorization", "Payer is not a member of this group");
    }

    for (const participant of participants) {
      const participantIsMember = await this.persistence.membershipExists(
        groupId,
        participant,
      );
      if (!participantIsMember) {
        return err(
          "authorization",
          "A participant is not a member of this group",
        );
      }
    }

    return ok(undefined);
  }

  /**
   * Confirm both payer and receiver are group members (Req 5.4, 13.2).
   *
   * Checks:
   * 1. Group exists → else `not_found`.
   * 2. `fromUser` (payer) is a member → else `authorization`.
   * 3. `toUser` (receiver) is a member → else `authorization`.
   *
   * Messages are PII-free and do not disclose group contents (Req 5.2, 21.4).
   */
  async requireSettlementPartiesAreMembers(
    groupId: string,
    fromUser: string,
    toUser: string,
  ): Promise<Result<void>> {
    const groupFound = await this.persistence.groupExists(groupId);
    if (!groupFound) {
      return err("not_found", "Group does not exist");
    }

    const payerIsMember = await this.persistence.membershipExists(
      groupId,
      fromUser,
    );
    if (!payerIsMember) {
      return err(
        "authorization",
        "Settlement payer is not a member of this group",
      );
    }

    const receiverIsMember = await this.persistence.membershipExists(
      groupId,
      toUser,
    );
    if (!receiverIsMember) {
      return err(
        "authorization",
        "Settlement receiver is not a member of this group",
      );
    }

    return ok(undefined);
  }
}
