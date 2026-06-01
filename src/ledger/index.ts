/**
 * Ledger Service (orchestration + persistence).
 *
 * This layer owns all writes and all balance derivation, composing the pure
 * domain core with persistence:
 *   - Auth_Guard membership/referential checks (Req 5, INV-6) — see tasks 10.x
 *   - write orchestration: addExpense / recordSettlement     — see tasks 12.x
 *   - Persistence interface, in-memory fake, withOccRetry (INV-3) — tasks 9.x
 *   - real Aurora DSQL persistence + connection              — see tasks 14.x
 *
 * The browser never touches Persistence directly; every financial mutation
 * passes through this service (design: Architecture, Req 19.6).
 */

// Persistence interface + row types (task 9.1)
export type {
  Persistence,
  ExpenseRow,
  SplitRow,
  SettlementRow,
  UserRow,
  GroupRow,
  MembershipRow,
} from "./persistence";

// In-memory fake (task 9.1) — for property tests and unit tests
export { InMemoryPersistence, OccConflictError } from "./in-memory-persistence";

// OCC retry wrapper (task 9.2) — withOccRetry + OccExhaustedError
export {
  OCC_CONFLICT,
  OccExhaustedError,
  withOccRetry,
  type OccRetryOptions,
} from "./occ-retry";

// Auth_Guard (task 10.1) — membership authorization checks (Req 5, INV-6)
export { AuthGuard } from "./auth-guard";

// Service functions (task 11) — identity, group, and membership management
export type {
  RegisterMemberInput,
  CreateGroupInput,
  JoinGroupInput,
} from "./services";
export {
  registerMember,
  updateCurrencyPreference,
  createGroup,
  joinGroup,
} from "./services";

// Write orchestration (task 12) — addExpense, recordSettlement, correctExpense
export { addExpense, recordSettlement, correctExpense } from "./orchestration";

// Real Aurora DSQL persistence + connection (task 14)
export { DsqlPersistence, getDsqlConnection, closeDsqlConnection } from "./dsql";
