/**
 * Ledger Service functions for identity, group, and membership management.
 *
 * These service functions compose validation logic with the Persistence
 * interface to implement member registration, currency-preference updates,
 * group creation, and group joining.
 *
 * Design references:
 *   - Member registration: Req 1.1, 1.2, 1.3, 1.4, 1.6, 21.2
 *   - Currency preference: Req 1.5, 1.7
 *   - Group creation: Req 3.1, 3.2, 3.3, 3.4
 *   - Group joining: Req 4.1, 4.2, 4.3, 4.5, 13.4
 */

import { ok, err, type Result, isValidCurrency } from "@/domain";
import type { Persistence } from "./persistence";

// ─── Email Validation ────────────────────────────────────────────────────────

/**
 * Simple email format check: something@something.something, no spaces.
 * Not RFC 5322 — just the basic structural requirement from Req 1.4.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Member Registration (Task 11.1) ────────────────────────────────────────

export interface RegisterMemberInput {
  displayName: string;
  email: string;
  homeRegion: string;
}

/**
 * Register a new member with validated display name and email.
 *
 * - Trims display name; rejects empty/whitespace-only or >100 chars (Req 1.1, 1.3)
 * - Validates email format and ≤254 chars (Req 1.4)
 * - Generates a UUID id (Req 1.6)
 * - Defaults currency_pref to 'USD' (Req 1.1)
 * - Stores only display name, email, home region, currency preference (Req 21.2)
 *
 * @returns The new member's id on success, or a validation error.
 */
export async function registerMember(
  persistence: Persistence,
  input: RegisterMemberInput,
): Promise<Result<string>> {
  // Validate display name
  const trimmedName = input.displayName.trim();
  if (trimmedName.length === 0 || trimmedName.length > 100) {
    return err(
      "validation",
      "Display name must be between 1 and 100 characters after trimming.",
      { field: "displayName" },
    );
  }

  // Validate email
  const email = input.email.trim();
  if (email.length > 254 || !EMAIL_REGEX.test(email)) {
    return err(
      "validation",
      "A valid email address is required (max 254 characters).",
      { field: "email" },
    );
  }

  // Create the user row with UUID and defaults
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  return persistence.insertUser({
    id,
    displayName: trimmedName,
    email,
    homeRegion: input.homeRegion,
    currencyPref: "USD",
    createdAt: now,
  });
}

// ─── Currency Preference Update (Task 11.3) ─────────────────────────────────

/**
 * Update a member's currency preference.
 *
 * - Validates the code is a known ISO-4217 currency (Req 1.5, 1.7)
 * - Rejects invalid codes without changing the existing preference
 *
 * @returns void on success, or a validation error for invalid codes.
 */
export async function updateCurrencyPreference(
  persistence: Persistence,
  userId: string,
  code: string,
): Promise<Result<void>> {
  if (!isValidCurrency(code)) {
    return err(
      "validation",
      "Invalid currency code. Must be a valid ISO-4217 code.",
      { field: "currencyPref" },
    );
  }

  return persistence.updateCurrencyPreference(userId, code);
}

// ─── Group Creation (Task 11.5) ──────────────────────────────────────────────

export interface CreateGroupInput {
  name: string;
  baseCurrency: string;
  creatorId: string;
}

/**
 * Create a group and record the creator as the first member.
 *
 * - Validates name is non-empty after trim (Req 3.1)
 * - Validates base currency is a valid ISO-4217 code (Req 3.2)
 * - Generates UUID for the group (Req 3.4) and a membership record
 * - Records the creator as a member with a joined_at timestamp (Req 3.3)
 *
 * @returns The new group's id on success, or a validation error.
 */
export async function createGroup(
  persistence: Persistence,
  input: CreateGroupInput,
): Promise<Result<string>> {
  // Validate group name
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    return err(
      "validation",
      "Group name is required.",
      { field: "name" },
    );
  }

  // Validate base currency
  if (!isValidCurrency(input.baseCurrency)) {
    return err(
      "validation",
      "Invalid base currency. Must be a valid ISO-4217 code.",
      { field: "baseCurrency" },
    );
  }

  // Create the group
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();

  const groupResult = await persistence.insertGroup({
    id: groupId,
    name: trimmedName,
    baseCurrency: input.baseCurrency,
    createdAt: now,
  });

  if (!groupResult.ok) {
    return groupResult;
  }

  // Record the creator as the first member
  const membershipId = crypto.randomUUID();
  const membershipResult = await persistence.insertMembership({
    id: membershipId,
    groupId,
    userId: input.creatorId,
    joinedAt: now,
  });

  if (!membershipResult.ok) {
    return membershipResult;
  }

  return ok(groupId);
}

// ─── Group Joining (Task 11.7) ───────────────────────────────────────────────

export interface JoinGroupInput {
  groupId: string;
  userId: string;
}

/**
 * Join a member to an existing group.
 *
 * - Verifies the group exists; rejects with not_found if it doesn't (Req 4.3)
 * - Creates a membership with a joined_at timestamp (Req 4.1, 4.5)
 * - Duplicate (member, group) joins are handled idempotently by persistence (Req 4.2, 13.4)
 *
 * @returns The membership id on success, or a not_found/validation error.
 */
export async function joinGroup(
  persistence: Persistence,
  input: JoinGroupInput,
): Promise<Result<string>> {
  // Verify the group exists
  const exists = await persistence.groupExists(input.groupId);
  if (!exists) {
    return err(
      "not_found",
      "Group not found.",
      { field: "groupId" },
    );
  }

  // Create the membership
  const membershipId = crypto.randomUUID();
  const now = new Date().toISOString();

  return persistence.insertMembership({
    id: membershipId,
    groupId: input.groupId,
    userId: input.userId,
    joinedAt: now,
  });
}
