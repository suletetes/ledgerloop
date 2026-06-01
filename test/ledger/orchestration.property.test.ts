/**
 * Property-based tests for Ledger Service write orchestration.
 *
 * Validates: Requirements 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7,
 *            6.9, 6.10, 6.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 11.5, 13.1,
 *            13.2, 13.3, 22.1
 */
import { describe, it, expect } from "vitest";
import { fc, assertAsyncProperty } from "../helpers/property";
import {
  iso4217Code,
  nonIso4217Code,
  safeAmountMinorNumber,
} from "../helpers/generators";
import {
  InMemoryPersistence,
  addExpense,
  recordSettlement,
  correctExpense,
} from "@/ledger";
import { deriveNetPositions } from "@/domain";
import type { ExpenseInput, SettlementInput } from "@/domain";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Set up a group with N members in InMemoryPersistence. Returns groupId and memberIds. */
async function setupGroup(
  persistence: InMemoryPersistence,
  memberCount: number,
): Promise<{ groupId: string; memberIds: string[] }> {
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await persistence.insertGroup({
    id: groupId,
    name: "Test Group",
    baseCurrency: "USD",
    createdAt: now,
  });

  const memberIds: string[] = [];
  for (let i = 0; i < memberCount; i++) {
    const userId = crypto.randomUUID();
    await persistence.insertUser({
      id: userId,
      displayName: `Member ${i}`,
      email: `member${i}@test.com`,
      homeRegion: "us-east-1",
      currencyPref: "USD",
      createdAt: now,
    });
    await persistence.insertMembership({
      id: crypto.randomUUID(),
      groupId,
      userId,
      joinedAt: now,
    });
    memberIds.push(userId);
  }

  return { groupId, memberIds };
}

/** A valid description: 1–100 non-whitespace chars. */
function validDescription(): fc.Arbitrary<string> {
  return fc
    .array(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
      { minLength: 1, maxLength: 100 },
    )
    .map((chars) => chars.join(""));
}

// ─── Property 4: Expense field validation ────────────────────────────────────

// Feature: ledgerloop-app, Property 4: Expense field validation
describe("Property 4: Expense field validation", () => {
  it("rejects invalid inputs with the offending field identified; accepts valid inputs", async () => {
    /**
     * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.9, 6.10
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        // Choose which invalid case to test (or valid)
        fc.oneof(
          // Invalid: bad amount (0, negative, non-integer, NaN)
          fc.constantFrom(0, -1, -100, 0.5, 1.7).map((amt) => ({
            kind: "invalid" as const,
            field: "amountMinor",
            input: { amountMinor: amt },
          })),
          // Invalid: bad currency (non-ISO-4217)
          nonIso4217Code().map((cur) => ({
            kind: "invalid" as const,
            field: "currency",
            input: { currency: cur },
          })),
          // Invalid: empty description
          fc.constantFrom("", "   ", "\t\n").map((desc) => ({
            kind: "invalid" as const,
            field: "description",
            input: { description: desc },
          })),
          // Invalid: empty participants
          fc.constant({
            kind: "invalid" as const,
            field: "participants",
            input: { participants: [] as string[] },
          }),
          // Valid input
          fc
            .tuple(safeAmountMinorNumber(), iso4217Code(), validDescription())
            .map(([amt, cur, desc]) => ({
              kind: "valid" as const,
              field: undefined,
              input: { amountMinor: amt, currency: cur, description: desc },
            })),
        ),
        async (testCase) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(persistence, 3);
          const callerId = memberIds[0]!;
          const participants = [memberIds[0]!, memberIds[1]!, memberIds[2]!];

          const baseInput: ExpenseInput = {
            groupId,
            paidBy: callerId,
            amountMinor: 1000,
            currency: "USD",
            description: "Test expense",
            splitType: "equal",
            participants,
          };

          const input: ExpenseInput = { ...baseInput, ...testCase.input };

          const result = await addExpense(persistence, callerId, input);

          if (testCase.kind === "invalid") {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("validation");
              expect(result.error.field).toBe(testCase.field);
            }
          } else {
            expect(result.ok).toBe(true);
          }
        },
      ),
    );
  });
});

// ─── Property 5: Expense write is atomic ─────────────────────────────────────

// Feature: ledgerloop-app, Property 5: Expense write is atomic
describe("Property 5: Expense write is atomic", () => {
  it("either the expense and all splits are persisted together, or none are", async () => {
    /**
     * Validates: Requirements 6.1, 6.11
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        safeAmountMinorNumber(),
        iso4217Code(),
        validDescription(),
        fc.integer({ min: 2, max: 5 }),
        async (amount, currency, description, memberCount) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(
            persistence,
            memberCount,
          );
          const callerId = memberIds[0]!;

          const input: ExpenseInput = {
            groupId,
            paidBy: callerId,
            amountMinor: amount,
            currency,
            description,
            splitType: "equal",
            participants: memberIds,
          };

          const result = await addExpense(persistence, callerId, input);
          const snapshot = await persistence.loadLedger(groupId);

          if (result.ok) {
            // On success: expense AND all splits must exist
            const expenseId = result.value;
            const expense = snapshot.expenses.find(
              (e) => e.id === expenseId,
            );
            expect(expense).toBeDefined();

            const splits = snapshot.splits.filter(
              (s) => s.expenseId === expenseId,
            );
            expect(splits.length).toBe(memberCount);

            // Splits sum to the expense amount
            const splitSum = splits.reduce(
              (sum, s) => sum + s.shareMinor,
              0,
            );
            expect(splitSum).toBe(amount);
          } else {
            // On rejection: neither expense nor splits should exist for this
            // attempt (the ledger should have no new entries from this call)
            // Since we start fresh each iteration, the ledger should be empty
            expect(snapshot.expenses.length).toBe(0);
            expect(snapshot.splits.length).toBe(0);
          }
        },
      ),
    );
  });
});

// ─── Property 7: Authorization and referential-integrity write guard (INV-6) ─

// Feature: ledgerloop-app, Property 7: Authorization and referential-integrity write guard (INV-6)
describe("Property 7: Authorization and referential-integrity write guard (INV-6)", () => {
  it("blocks writes when group doesn't exist or payer/participants aren't members", async () => {
    /**
     * Validates: Requirements 5.3, 5.4, 5.5, 13.1, 13.2, 13.3
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        // Choose scenario: non-existent group, non-member payer, non-member participant, non-member settlement party
        fc.constantFrom(
          "no_group_expense",
          "non_member_payer",
          "non_member_participant",
          "no_group_settlement",
          "non_member_settlement_from",
          "non_member_settlement_to",
        ),
        safeAmountMinorNumber(),
        async (scenario, amount) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(persistence, 3);
          const callerId = memberIds[0]!;
          const nonMemberId = crypto.randomUUID();
          const fakeGroupId = crypto.randomUUID();

          if (scenario === "no_group_expense") {
            // Expense on a non-existent group
            const input: ExpenseInput = {
              groupId: fakeGroupId,
              paidBy: callerId,
              amountMinor: amount,
              currency: "USD",
              description: "Test",
              splitType: "equal",
              participants: [callerId, memberIds[1]!],
            };
            const result = await addExpense(persistence, callerId, input);
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("not_found");
            }
            // Nothing written
            const snap = await persistence.loadLedger(fakeGroupId);
            expect(snap.expenses.length).toBe(0);
          } else if (scenario === "non_member_payer") {
            // Payer is not a member
            const input: ExpenseInput = {
              groupId,
              paidBy: nonMemberId,
              amountMinor: amount,
              currency: "USD",
              description: "Test",
              splitType: "equal",
              participants: [memberIds[0]!, memberIds[1]!],
            };
            const result = await addExpense(persistence, callerId, input);
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("authorization");
            }
            const snap = await persistence.loadLedger(groupId);
            expect(snap.expenses.length).toBe(0);
          } else if (scenario === "non_member_participant") {
            // A participant is not a member
            const input: ExpenseInput = {
              groupId,
              paidBy: callerId,
              amountMinor: amount,
              currency: "USD",
              description: "Test",
              splitType: "equal",
              participants: [callerId, nonMemberId],
            };
            const result = await addExpense(persistence, callerId, input);
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("authorization");
            }
            const snap = await persistence.loadLedger(groupId);
            expect(snap.expenses.length).toBe(0);
          } else if (scenario === "no_group_settlement") {
            // Settlement on a non-existent group
            const input: SettlementInput = {
              groupId: fakeGroupId,
              fromUser: callerId,
              toUser: memberIds[1]!,
              amountMinor: amount,
              currency: "USD",
            };
            const result = await recordSettlement(
              persistence,
              callerId,
              input,
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("not_found");
            }
          } else if (scenario === "non_member_settlement_from") {
            // Settlement payer is not a member
            const input: SettlementInput = {
              groupId,
              fromUser: nonMemberId,
              toUser: memberIds[1]!,
              amountMinor: amount,
              currency: "USD",
            };
            const result = await recordSettlement(
              persistence,
              callerId,
              input,
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("authorization");
            }
          } else {
            // non_member_settlement_to: Settlement receiver is not a member
            const input: SettlementInput = {
              groupId,
              fromUser: callerId,
              toUser: nonMemberId,
              amountMinor: amount,
              currency: "USD",
            };
            const result = await recordSettlement(
              persistence,
              callerId,
              input,
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("authorization");
            }
          }
        },
      ),
    );
  });
});

// ─── Property 15: Settlement field validation ────────────────────────────────

// Feature: ledgerloop-app, Property 15: Settlement field validation
describe("Property 15: Settlement field validation", () => {
  it("rejects invalid settlements; accepts valid settlements within the cap", async () => {
    /**
     * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.oneof(
          // Invalid: bad amount (0, negative, non-integer)
          fc.constantFrom(0, -1, -50, 0.5).map((amt) => ({
            kind: "invalid" as const,
            field: "amountMinor",
            input: { amountMinor: amt },
          })),
          // Invalid: bad currency
          nonIso4217Code().map((cur) => ({
            kind: "invalid" as const,
            field: "currency",
            input: { currency: cur },
          })),
          // Invalid: same payer and receiver
          fc.constant({
            kind: "same_user" as const,
            field: "toUser",
            input: {},
          }),
          // Valid settlement
          fc.tuple(iso4217Code()).map(([cur]) => ({
            kind: "valid" as const,
            field: undefined,
            input: { currency: cur },
          })),
        ),
        async (testCase) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(persistence, 3);
          const payer = memberIds[0]!;
          const receiver = memberIds[1]!;

          // Create a debt: payer pays an expense split among receiver
          // so receiver owes payer
          const expenseInput: ExpenseInput = {
            groupId,
            paidBy: payer,
            amountMinor: 10000,
            currency: "USD",
            description: "Dinner",
            splitType: "equal",
            participants: [payer, receiver],
          };
          await addExpense(persistence, payer, expenseInput);

          // Now receiver owes payer ~5000. The settlement goes from receiver to payer.
          const baseSettlement: SettlementInput = {
            groupId,
            fromUser: receiver,
            toUser: payer,
            amountMinor: 5000,
            currency: "USD",
          };

          let input: SettlementInput;
          if (testCase.kind === "same_user") {
            input = { ...baseSettlement, fromUser: payer, toUser: payer };
          } else {
            input = { ...baseSettlement, ...testCase.input };
          }

          const result = await recordSettlement(persistence, payer, input);

          if (testCase.kind === "valid") {
            expect(result.ok).toBe(true);
            if (result.ok) {
              // Exactly one settlement recorded
              const snap = await persistence.loadLedger(groupId);
              const settlements = snap.settlements.filter(
                (s) =>
                  s.fromUser === receiver && s.toUser === payer,
              );
              expect(settlements.length).toBe(1);
            }
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.category).toBe("validation");
              expect(result.error.field).toBe(testCase.field);
            }
          }
        },
      ),
    );
  });
});

// ─── Property 6: Corrections are append-only reversals ───────────────────────

// Feature: ledgerloop-app, Property 6: Corrections are append-only reversals
describe("Property 6: Corrections are append-only reversals", () => {
  it("produces a new reversing expense and leaves the original unchanged", async () => {
    /**
     * Validates: Requirements 6.6, 6.7
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        safeAmountMinorNumber(),
        iso4217Code(),
        validDescription(),
        fc.integer({ min: 2, max: 5 }),
        async (amount, currency, description, memberCount) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(
            persistence,
            memberCount,
          );
          const callerId = memberIds[0]!;

          // Add an expense
          const input: ExpenseInput = {
            groupId,
            paidBy: callerId,
            amountMinor: amount,
            currency,
            description,
            splitType: "equal",
            participants: memberIds,
          };
          const addResult = await addExpense(persistence, callerId, input);
          expect(addResult.ok).toBe(true);
          if (!addResult.ok) return;

          const originalExpenseId = addResult.value;

          // Snapshot before correction
          const snapBefore = await persistence.loadLedger(groupId);
          const originalExpense = snapBefore.expenses.find(
            (e) => e.id === originalExpenseId,
          );
          const originalSplits = snapBefore.splits.filter(
            (s) => s.expenseId === originalExpenseId,
          );

          // Correct the expense
          const corrResult = await correctExpense(
            persistence,
            callerId,
            originalExpenseId,
            groupId,
          );
          expect(corrResult.ok).toBe(true);
          if (!corrResult.ok) return;

          const reversalId = corrResult.value;

          // Snapshot after correction
          const snapAfter = await persistence.loadLedger(groupId);

          // Original expense is unchanged
          const originalAfter = snapAfter.expenses.find(
            (e) => e.id === originalExpenseId,
          );
          expect(originalAfter).toEqual(originalExpense);

          // Original splits are unchanged
          const originalSplitsAfter = snapAfter.splits.filter(
            (s) => s.expenseId === originalExpenseId,
          );
          expect(originalSplitsAfter).toEqual(originalSplits);

          // A new reversing expense exists
          const reversal = snapAfter.expenses.find(
            (e) => e.id === reversalId,
          );
          expect(reversal).toBeDefined();
          expect(reversal!.amountMinor).toBe(-amount);
          expect(reversal!.paidBy).toBe(callerId);

          // Reversal splits negate the original splits
          const reversalSplits = snapAfter.splits.filter(
            (s) => s.expenseId === reversalId,
          );
          expect(reversalSplits.length).toBe(originalSplits.length);

          for (const origSplit of originalSplits) {
            const matchingReversal = reversalSplits.find(
              (s) => s.userId === origSplit.userId,
            );
            expect(matchingReversal).toBeDefined();
            expect(matchingReversal!.shareMinor).toBe(-origSplit.shareMinor);
          }
        },
      ),
    );
  });
});

// ─── Property 27: Non-OCC write failures leave the ledger unchanged ──────────

// Feature: ledgerloop-app, Property 27: Non-OCC write failures leave the ledger unchanged
describe("Property 27: Non-OCC write failures leave the ledger unchanged", () => {
  it("on any non-OCC write failure, the ledger state is identical before and after", async () => {
    /**
     * Validates: Requirements 22.1
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        // Choose a failure scenario
        fc.constantFrom(
          "validation_bad_amount",
          "validation_bad_currency",
          "validation_empty_desc",
          "auth_non_member_payer",
          "auth_non_member_participant",
          "settlement_same_user",
          "settlement_exceeds_cap",
        ),
        safeAmountMinorNumber(),
        async (scenario, amount) => {
          const persistence = new InMemoryPersistence();
          const { groupId, memberIds } = await setupGroup(persistence, 3);
          const callerId = memberIds[0]!;
          const nonMemberId = crypto.randomUUID();

          // Add a valid expense first so the ledger has some state
          const validInput: ExpenseInput = {
            groupId,
            paidBy: callerId,
            amountMinor: 5000,
            currency: "USD",
            description: "Existing expense",
            splitType: "equal",
            participants: [memberIds[0]!, memberIds[1]!],
          };
          await addExpense(persistence, callerId, validInput);

          // Snapshot before the failing write
          const snapBefore = await persistence.loadLedger(groupId);

          // Attempt a write that will fail for a non-OCC reason
          if (scenario === "validation_bad_amount") {
            await addExpense(persistence, callerId, {
              ...validInput,
              amountMinor: -1,
            });
          } else if (scenario === "validation_bad_currency") {
            await addExpense(persistence, callerId, {
              ...validInput,
              currency: "INVALID",
            });
          } else if (scenario === "validation_empty_desc") {
            await addExpense(persistence, callerId, {
              ...validInput,
              description: "",
            });
          } else if (scenario === "auth_non_member_payer") {
            await addExpense(persistence, callerId, {
              ...validInput,
              paidBy: nonMemberId,
            });
          } else if (scenario === "auth_non_member_participant") {
            await addExpense(persistence, callerId, {
              ...validInput,
              participants: [callerId, nonMemberId],
            });
          } else if (scenario === "settlement_same_user") {
            await recordSettlement(persistence, callerId, {
              groupId,
              fromUser: callerId,
              toUser: callerId,
              amountMinor: amount,
              currency: "USD",
            });
          } else {
            // settlement_exceeds_cap: try to settle more than owed
            await recordSettlement(persistence, callerId, {
              groupId,
              fromUser: memberIds[1]!,
              toUser: callerId,
              amountMinor: 999999,
              currency: "USD",
            });
          }

          // Snapshot after the failing write
          const snapAfter = await persistence.loadLedger(groupId);

          // Ledger must be unchanged
          expect(snapAfter.expenses).toEqual(snapBefore.expenses);
          expect(snapAfter.splits).toEqual(snapBefore.splits);
          expect(snapAfter.settlements).toEqual(snapBefore.settlements);
        },
      ),
    );
  });
});

// ─── Property 19: No append is double-counted under any interleaving (INV-3) ─

// Feature: ledgerloop-app, Property 19: No append is double-counted under any interleaving (INV-3)
describe("Property 19: No append is double-counted under any interleaving (INV-3)", () => {
  it("derived balances equal those from serial application regardless of OCC conflicts", async () => {
    /**
     * Validates: Requirements 11.5
     */
    await assertAsyncProperty(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // number of OCC conflicts to inject
        fc.integer({ min: 2, max: 4 }), // number of expenses to submit
        fc.array(safeAmountMinorNumber(), { minLength: 2, maxLength: 4 }),
        async (conflictCount, _expenseCount, amounts) => {
          // ── Serial baseline (no conflicts) ──
          const serialPersistence = new InMemoryPersistence();
          const { groupId: serialGroupId, memberIds: serialMembers } =
            await setupGroup(serialPersistence, 3);
          const serialCaller = serialMembers[0]!;

          for (const amt of amounts) {
            const input: ExpenseInput = {
              groupId: serialGroupId,
              paidBy: serialCaller,
              amountMinor: amt,
              currency: "USD",
              description: "Expense",
              splitType: "equal",
              participants: serialMembers,
            };
            await addExpense(serialPersistence, serialCaller, input);
          }

          const serialSnapshot = await serialPersistence.loadLedger(
            serialGroupId,
          );
          const serialNet = deriveNetPositions(serialSnapshot);

          // ── With OCC conflicts injected ──
          const conflictPersistence = new InMemoryPersistence();
          const { groupId: conflictGroupId, memberIds: conflictMembers } =
            await setupGroup(conflictPersistence, 3);
          const conflictCaller = conflictMembers[0]!;

          // Inject conflicts before the first expense write
          conflictPersistence.injectOccConflict(conflictCount);

          for (const amt of amounts) {
            const input: ExpenseInput = {
              groupId: conflictGroupId,
              paidBy: conflictCaller,
              amountMinor: amt,
              currency: "USD",
              description: "Expense",
              splitType: "equal",
              participants: conflictMembers,
            };
            await addExpense(conflictPersistence, conflictCaller, input);
          }

          const conflictSnapshot = await conflictPersistence.loadLedger(
            conflictGroupId,
          );
          const conflictNet = deriveNetPositions(conflictSnapshot);

          // ── Compare: same net positions ──
          // The member IDs differ between the two runs, so compare by position
          const serialNetValues = serialMembers.map(
            (id) => serialNet.get(id) ?? 0,
          );
          const conflictNetValues = conflictMembers.map(
            (id) => conflictNet.get(id) ?? 0,
          );

          expect(conflictNetValues).toEqual(serialNetValues);
        },
      ),
    );
  });
});
