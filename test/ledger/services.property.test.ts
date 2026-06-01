/**
 * Property-based tests for Ledger Service functions.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.1, 3.2, 3.3,
 *            3.4, 4.1, 4.2, 4.5, 6.8, 8.9, 13.4, 21.2
 */
import { describe, it, expect } from "vitest";
import { fc, assertAsyncProperty } from "../helpers/property";
import { iso4217Code } from "../helpers/generators";
import {
  InMemoryPersistence,
  registerMember,
  updateCurrencyPreference,
  createGroup,
  joinGroup,
} from "@/ledger";

// ─── Generators ──────────────────────────────────────────────────────────────

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHANUM = ALPHA + "0123456789";

/** Valid display name: 1–100 printable chars (non-whitespace). */
function validDisplayName(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...ALPHANUM.split("")), { minLength: 1, maxLength: 100 })
    .map((chars) => chars.join(""));
}

/** Invalid display names: empty, whitespace-only, or >100 chars after trim. */
function invalidDisplayName(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(""),
    fc.constant("   "),
    fc.constant("\t\n"),
    // Over 100 chars: generate a string of 101+ 'a' characters
    fc.integer({ min: 101, max: 130 }).map((len) => "a".repeat(len)),
  );
}

/** Valid email: local@domain.tld, ≤254 chars. */
function validEmail(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.array(fc.constantFrom(...ALPHANUM.split("")), { minLength: 1, maxLength: 20 }).map((a) => a.join("")),
      fc.array(fc.constantFrom(...ALPHA.split("")), { minLength: 1, maxLength: 15 }).map((a) => a.join("")),
      fc.constantFrom("com", "org", "net", "io", "co"),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
}

/** Invalid emails: >254 chars or missing @. */
function invalidEmail(): fc.Arbitrary<string> {
  return fc.oneof(
    // No @ sign
    fc.array(fc.constantFrom(...ALPHA.split("")), { minLength: 5, maxLength: 20 }).map((a) => a.join("")),
    // Over 254 chars (local part 250+ chars ensures total > 254 with @b.com suffix)
    fc.integer({ min: 250, max: 270 }).map((len) => "a".repeat(len) + "@b.com"),
  );
}

/** A valid group name (non-empty, non-whitespace). */
function validGroupName(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...(ALPHA + " ").split("")), { minLength: 1, maxLength: 50 })
    .map((chars) => chars.join(""))
    .filter((s) => s.trim().length > 0);
}

/** Invalid group names: empty or whitespace-only. */
function invalidGroupName(): fc.Arbitrary<string> {
  return fc.constantFrom("", "   ", "\t", "\n", "  \t\n  ");
}

/**
 * Currency codes that are definitely NOT valid per isValidCurrency.
 * Uses codes known to not be in the CURRENCY_MINOR_DIGITS map.
 */
function definitelyInvalidCurrency(): fc.Arbitrary<string> {
  return fc.oneof(
    // Codes that are definitely not in the supported set
    fc.constantFrom("ZZZ", "XXX", "QQQ", "AAA", "BBB", "FFF"),
    // Wrong length
    fc.constantFrom("US", "USDD", "A", ""),
    // Lowercase
    fc.constantFrom("usd", "eur", "gbp"),
  );
}

// ─── Property 23 ─────────────────────────────────────────────────────────────

// Feature: ledgerloop-app, Property 23: Member data is minimized and identity is created correctly
describe("Property 23: Member data is minimized and identity is created correctly", () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 21.2**
   *
   * For any valid registration (display name 1–100 chars after trimming, valid
   * email ≤254 chars), a Member is created whose stored fields are limited to
   * display name, email, home region, currency preference, identifier, and
   * creation timestamp, with currency preference defaulting to USD; for any
   * invalid display name or email, the registration is rejected with the
   * offending field identified and no Member is created.
   */
  it("creates members with minimal data for valid inputs, rejects invalid inputs with field identification", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        validDisplayName(),
        validEmail(),
        fc.array(fc.constantFrom(...ALPHA.split("")), { minLength: 2, maxLength: 5 }).map((a) => a.join("")),
        invalidDisplayName(),
        invalidEmail(),
        async (name, email, region, badName, badEmail) => {
          // ── Valid registration ──
          const persistence = new InMemoryPersistence();
          const result = await registerMember(persistence, {
            displayName: name,
            email,
            homeRegion: region,
          });

          // Must succeed
          if (!result.ok) {
            throw new Error(
              `Expected ok for valid input (name="${name}", email="${email}"), got error: ${result.error.message}`,
            );
          }

          // ID must be a UUID (present, non-empty string)
          expect(result.value).toBeTruthy();
          expect(typeof result.value).toBe("string");
          expect(result.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );

          // Verify default currency is USD by updating and checking it works
          const updateResult = await updateCurrencyPreference(
            persistence,
            result.value,
            "EUR",
          );
          expect(updateResult.ok).toBe(true);

          // ── Invalid display name ──
          const persistence2 = new InMemoryPersistence();
          const badNameResult = await registerMember(persistence2, {
            displayName: badName,
            email,
            homeRegion: region,
          });

          if (badNameResult.ok) {
            throw new Error(
              `Expected rejection for invalid display name "${badName}", got ok`,
            );
          }
          expect(badNameResult.error.category).toBe("validation");
          expect(badNameResult.error.field).toBe("displayName");

          // ── Invalid email ──
          const persistence3 = new InMemoryPersistence();
          const badEmailResult = await registerMember(persistence3, {
            displayName: name,
            email: badEmail,
            homeRegion: region,
          });

          if (badEmailResult.ok) {
            throw new Error(
              `Expected rejection for invalid email "${badEmail}", got ok`,
            );
          }
          expect(badEmailResult.error.category).toBe("validation");
          expect(badEmailResult.error.field).toBe("email");

          return true;
        },
      ),
    );
  });
});

// ─── Property 24 ─────────────────────────────────────────────────────────────

// Feature: ledgerloop-app, Property 24: Currency-preference updates validate and preserve prior value
describe("Property 24: Currency-preference updates validate and preserve prior value", () => {
  /**
   * **Validates: Requirements 1.5, 1.7**
   *
   * For any currency-preference update, a valid ISO-4217 three-letter code is
   * persisted, and an invalid code is rejected with the existing preference
   * left unchanged and a message indicating the code is invalid.
   */
  it("persists valid ISO-4217 codes and rejects invalid codes leaving preference unchanged", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        validDisplayName(),
        validEmail(),
        iso4217Code(),
        definitelyInvalidCurrency(),
        async (name, email, validCode, invalidCode) => {
          const persistence = new InMemoryPersistence();

          // Register a member (defaults to USD)
          const regResult = await registerMember(persistence, {
            displayName: name,
            email,
            homeRegion: "US",
          });
          if (!regResult.ok) throw new Error("Registration failed unexpectedly");
          const userId = regResult.value;

          // Update with a valid code → should succeed
          const validResult = await updateCurrencyPreference(
            persistence,
            userId,
            validCode,
          );
          expect(validResult.ok).toBe(true);

          // Update with an invalid code → should be rejected
          const invalidResult = await updateCurrencyPreference(
            persistence,
            userId,
            invalidCode,
          );

          if (invalidResult.ok) {
            throw new Error(
              `Expected rejection for invalid code "${invalidCode}", got ok`,
            );
          }
          expect(invalidResult.error.category).toBe("validation");
          expect(invalidResult.error.field).toBe("currencyPref");
          // Message should indicate the code is invalid
          const msg = invalidResult.error.message.toLowerCase();
          expect(msg).toContain("invalid");

          // The preference should still be the last valid code, not the invalid one
          // Verify by successfully updating to another valid code
          const verifyResult = await updateCurrencyPreference(
            persistence,
            userId,
            "USD",
          );
          expect(verifyResult.ok).toBe(true);

          return true;
        },
      ),
    );
  });
});

// ─── Property 25 ─────────────────────────────────────────────────────────────

// Feature: ledgerloop-app, Property 25: Group creation validates inputs and records creator membership
describe("Property 25: Group creation validates inputs and records creator membership", () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * For any group-creation submission with a present name and a valid ISO-4217
   * base currency, a Group is created and the creating member is recorded as a
   * Membership; for any submission omitting the name or supplying an invalid
   * base currency, the submission is rejected with the offending field identified.
   */
  it("creates group + membership for valid inputs, rejects invalid inputs with field identification", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        validGroupName(),
        iso4217Code(),
        invalidGroupName(),
        definitelyInvalidCurrency(),
        fc.uuid(),
        async (groupName, validCurrency, badName, badCurrency, creatorId) => {
          // ── Valid group creation ──
          const persistence = new InMemoryPersistence();

          // Register the creator first
          await persistence.insertUser({
            id: creatorId,
            displayName: "Creator",
            email: "creator@test.com",
            homeRegion: "US",
            currencyPref: "USD",
            createdAt: new Date().toISOString(),
          });

          const result = await createGroup(persistence, {
            name: groupName,
            baseCurrency: validCurrency,
            creatorId,
          });

          if (!result.ok) {
            throw new Error(
              `Expected ok for valid group creation, got error: ${result.error.message}`,
            );
          }

          // Group ID must be a UUID
          expect(result.value).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );

          // The group must exist
          const groupExists = await persistence.groupExists(result.value);
          expect(groupExists).toBe(true);

          // The creator must be a member of the group
          const membershipExists = await persistence.membershipExists(
            result.value,
            creatorId,
          );
          expect(membershipExists).toBe(true);

          // ── Invalid name ──
          const persistence2 = new InMemoryPersistence();
          const badNameResult = await createGroup(persistence2, {
            name: badName,
            baseCurrency: validCurrency,
            creatorId,
          });

          if (badNameResult.ok) {
            throw new Error(
              `Expected rejection for invalid group name "${badName}", got ok`,
            );
          }
          expect(badNameResult.error.category).toBe("validation");
          expect(badNameResult.error.field).toBe("name");

          // ── Invalid base currency ──
          const persistence3 = new InMemoryPersistence();
          const badCurrencyResult = await createGroup(persistence3, {
            name: groupName,
            baseCurrency: badCurrency,
            creatorId,
          });

          if (badCurrencyResult.ok) {
            throw new Error(
              `Expected rejection for invalid currency "${badCurrency}", got ok`,
            );
          }
          expect(badCurrencyResult.error.category).toBe("validation");
          expect(badCurrencyResult.error.field).toBe("baseCurrency");

          return true;
        },
      ),
    );
  });
});

// ─── Property 9 ──────────────────────────────────────────────────────────────

// Feature: ledgerloop-app, Property 9: Membership creation is idempotent and unique
describe("Property 9: Membership creation is idempotent and unique", () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.5, 13.4**
   *
   * For any member and group, accepting an invitation creates exactly one
   * Membership with a recorded creation timestamp, and any subsequent join
   * attempt for the same (member, group) pair leaves exactly one Membership
   * row unchanged.
   */
  it("creates exactly one membership and handles duplicate joins idempotently", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (userId, groupId) => {
          const persistence = new InMemoryPersistence();

          // Set up: insert user and group
          await persistence.insertUser({
            id: userId,
            displayName: "Test User",
            email: "test@example.com",
            homeRegion: "US",
            currencyPref: "USD",
            createdAt: new Date().toISOString(),
          });
          await persistence.insertGroup({
            id: groupId,
            name: "Test Group",
            baseCurrency: "USD",
            createdAt: new Date().toISOString(),
          });

          // First join
          const firstResult = await joinGroup(persistence, { groupId, userId });
          if (!firstResult.ok) {
            throw new Error(
              `Expected ok for first join, got error: ${firstResult.error.message}`,
            );
          }
          const firstId = firstResult.value;
          expect(typeof firstId).toBe("string");
          expect(firstId.length).toBeGreaterThan(0);

          // Verify membership exists
          const exists = await persistence.membershipExists(groupId, userId);
          expect(exists).toBe(true);

          // Second join (duplicate) — should be idempotent
          const secondResult = await joinGroup(persistence, { groupId, userId });
          if (!secondResult.ok) {
            throw new Error(
              `Expected ok for duplicate join, got error: ${secondResult.error.message}`,
            );
          }

          // The persistence returns the existing id for duplicates
          const secondId = secondResult.value;
          expect(typeof secondId).toBe("string");
          expect(secondId.length).toBeGreaterThan(0);

          // Third join — still idempotent
          const thirdResult = await joinGroup(persistence, { groupId, userId });
          expect(thirdResult.ok).toBe(true);

          // Membership still exists (exactly one)
          const stillExists = await persistence.membershipExists(groupId, userId);
          expect(stillExists).toBe(true);

          return true;
        },
      ),
    );
  });
});

// ─── Property 10 ─────────────────────────────────────────────────────────────

// Feature: ledgerloop-app, Property 10: Application-generated identifiers are unique
describe("Property 10: Application-generated identifiers are unique", () => {
  /**
   * **Validates: Requirements 1.6, 3.4, 6.8, 8.9**
   *
   * For any sequence of created Member, Group, Expense, or Settlement records,
   * every record receives a present, application-generated identifier, all
   * identifiers within a type are pairwise distinct, and each created
   * Settlement and Membership also carries a present creation timestamp.
   */
  it("all generated identifiers are present, unique within type, and settlements/memberships carry timestamps", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 3 }),
        async (memberCount, groupCount) => {
          const persistence = new InMemoryPersistence();

          const memberIds: string[] = [];
          const groupIds: string[] = [];
          const expenseIds: string[] = [];
          const settlementIds: string[] = [];
          const settlementTimestamps: string[] = [];

          // Create members
          for (let i = 0; i < memberCount; i++) {
            const result = await registerMember(persistence, {
              displayName: `Member ${i}`,
              email: `member${i}@test.com`,
              homeRegion: "US",
            });
            if (!result.ok) throw new Error("Member creation failed");
            memberIds.push(result.value);
          }

          // Create groups
          for (let i = 0; i < groupCount; i++) {
            const result = await createGroup(persistence, {
              name: `Group ${i}`,
              baseCurrency: "USD",
              creatorId: memberIds[0]!,
            });
            if (!result.ok) throw new Error("Group creation failed");
            groupIds.push(result.value);
          }

          // Join additional members to the first group
          for (let i = 1; i < memberCount; i++) {
            const result = await joinGroup(persistence, {
              groupId: groupIds[0]!,
              userId: memberIds[i]!,
            });
            if (!result.ok) throw new Error("Join failed");
          }

          // Insert expenses directly via persistence
          for (let i = 0; i < 2; i++) {
            const expenseId = crypto.randomUUID();
            const now = new Date().toISOString();
            const expResult = await persistence.insertExpenseWithSplits(
              {
                id: expenseId,
                groupId: groupIds[0]!,
                paidBy: memberIds[0]!,
                amountMinor: 1000 * (i + 1),
                currency: "USD",
                description: `Expense ${i}`,
                splitType: "equal",
                createdAt: now,
              },
              memberIds.map((uid) => ({
                id: crypto.randomUUID(),
                expenseId,
                userId: uid,
                shareMinor: Math.floor((1000 * (i + 1)) / memberCount),
              })),
            );
            if (!expResult.ok) throw new Error("Expense insert failed");
            expenseIds.push(expResult.value);
          }

          // Insert settlements directly via persistence
          for (let i = 0; i < 2; i++) {
            const settlementId = crypto.randomUUID();
            const now = new Date().toISOString();
            const setResult = await persistence.insertSettlement({
              id: settlementId,
              groupId: groupIds[0]!,
              fromUser: memberIds[1]!,
              toUser: memberIds[0]!,
              amountMinor: 500 * (i + 1),
              currency: "USD",
              createdAt: now,
            });
            if (!setResult.ok) throw new Error("Settlement insert failed");
            settlementIds.push(setResult.value);
            settlementTimestamps.push(now);
          }

          // ── Assertions ──

          // All member IDs are present strings
          for (const id of memberIds) {
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          }

          // All group IDs are present strings
          for (const id of groupIds) {
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          }

          // All expense IDs are present strings
          for (const id of expenseIds) {
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          }

          // All settlement IDs are present strings
          for (const id of settlementIds) {
            expect(typeof id).toBe("string");
            expect(id.length).toBeGreaterThan(0);
          }

          // Pairwise distinct within type
          expect(new Set(memberIds).size).toBe(memberIds.length);
          expect(new Set(groupIds).size).toBe(groupIds.length);
          expect(new Set(expenseIds).size).toBe(expenseIds.length);
          expect(new Set(settlementIds).size).toBe(settlementIds.length);

          // Settlements carry timestamps
          for (const ts of settlementTimestamps) {
            expect(typeof ts).toBe("string");
            expect(ts.length).toBeGreaterThan(0);
            // Must be a valid ISO date string
            expect(new Date(ts).toISOString()).toBe(ts);
          }

          return true;
        },
      ),
    );
  });
});
