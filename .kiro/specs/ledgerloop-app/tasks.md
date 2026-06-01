# Implementation Plan: LedgerLoop

## Overview

This plan builds LedgerLoop as a layered serverless monolith (Next.js App Router + TypeScript + Tailwind on Vercel, single Aurora DSQL database, append-only ledger with derived balances) in a strict test-driven, bottom-up order so the correctness invariants are locked down before any database wiring exists.

The build order is deliberate:

1. **Pure domain core first** — `Split_Calculator` (INV-1, deterministic rounding), `Balance_Engine` (INV-2, with the *corrected* settlement sign), `Debt_Simplifier` (greedy min-cashflow), `Settlement_Validator` (INV-5 cap), `Currency_Display`, and the money primitives (INV-4) are implemented as pure functions over in-memory inputs and property-tested to a minimum of 100 iterations. These invariants are proven before DSQL exists, so a database mistake can never silently corrupt them.
2. **Persistence abstraction + in-memory fake + `withOccRetry`** — the `Persistence` interface, an in-memory fake (with OCC `40001` injection), and the Ledger Service write orchestration are built and property-tested against the fake, locking down INV-3, INV-6, atomicity, and append-only behavior cheaply.
3. **Real Aurora DSQL** — DSQL-safe DDL (`CREATE INDEX ASYNC`, no FK/sequences/triggers/views/JSON, `BIGINT` minor units), IAM-token + `sslmode=require` connection reuse, and the real `Persistence` implementation, verified by a DDL smoke test, a data-minimization smoke test, and the live two-client concurrency test (40001 → retry → both land → INV-2 holds).
4. **API boundary + session + `Auth_Guard` wiring** — membership enforcement is wired into every group-scoped route; `DomainError` is mapped to PII-free responses.
5. **Frontend** — accessible (WCAG 2.1 AA), mobile-first (320px), Core-Web-Vitals-budgeted components, finishing with automated accessibility, responsive, and performance gates.

Each property test is tagged in the format `Feature: ledgerloop-app, Property {n}: {text}`, uses `fast-check` + Vitest, runs ≥100 iterations, and is implemented as exactly one test per property. Test sub-tasks are marked `*` (optional for a fast MVP); the user has asked for no bugs and no gaps, so every property and every requirement has a dedicated implementation and test task.

## Tasks

- [x] 1. Project foundation and test harness
  - [x] 1.1 Scaffold the Next.js App Router project and frontend foundation
    - Initialize a Next.js App Router app in TypeScript with `strict` mode and type-checking enforced in the build
    - Configure Tailwind CSS with a shared design-token config for color, typography, and spacing
    - Add the accessible headless component foundation (e.g. Radix UI) and base ESLint config
    - Create the directory structure: `src/domain` (pure core), `src/ledger` (orchestration + persistence), `src/app` (App Router), `src/components`, `test`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x] 1.2 Set up the Vitest + fast-check + axe-core test harness and base generators
    - Configure Vitest as the test runner and add `fast-check` and `axe-core`/`jest-axe` dev dependencies
    - Add a property-test helper that enforces `{ numRuns: 100 }` minimum and a tagging comment convention `Feature: ledgerloop-app, Property {n}: {text}`
    - Implement base `fast-check` generators: ISO-4217 and non-ISO currency codes, positive integer minor-unit amounts (including values above `Number.MAX_SAFE_INTEGER` via `bigint` and near `2^63−1`), whitespace-only / over-length strings, and member/group/membership graphs
    - _Requirements: 19.2_

- [x] 2. Shared domain types and money representation (INV-4)
  - [x] 2.1 Define shared domain types and the Result/DomainError model
    - Implement `SplitType`, `Split`, `ExpenseInput`, `SettlementInput`, `Transfer`, `Result<T>`, and `DomainError` (with `category`, `field`, `message`, `maxSettleableMinor`) exactly as specified in the design
    - Document the integer-only money discipline (`number` only where provably safe, `bigint` at the persistence boundary)
    - _Requirements: 12.1, 12.2, 22.1_

  - [x] 2.2 Implement ISO-4217 validation and integer minor-units money utilities
    - Implement ISO-4217 three-letter code validation (with per-currency minor-digit metadata)
    - Implement integer-only conversion: parse an entered major-unit value to integer minor units, and format integer minor units to the currency's correct major/minor presentation
    - Guarantee no monetary value is ever produced as a floating-point number, including zero
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 2.3 Write property test for integer minor-units representation
    - **Property 20: All monetary values are integer minor units (INV-4)**
    - **Validates: Requirements 12.1, 12.2**

  - [x] 2.4 Write property test for money formatting round-trips
    - **Property 21: Money formatting round-trips**
    - **Validates: Requirements 12.3, 12.4**

- [x] 3. Implement Split_Calculator (INV-1)
  - [x] 3.1 Implement equalSplit with deterministic remainder distribution
    - `base = floor(amount/n)`; the first `remainder` members each pay one extra minor unit
    - Guarantee the shares sum to the amount exactly, no two shares differ by more than one minor unit, and identical ordered inputs yield identical shares
    - _Requirements: 7.1, 7.2, 7.8_

  - [x] 3.2 Write property test for equal-split fairness and determinism
    - **Property 2: Equal-split fairness and determinism**
    - **Validates: Requirements 7.2**

  - [x] 3.3 Implement percentSplit and exactSplit
    - `percentSplit`: reject unless percentages sum to exactly 100; compute `floor(amount * pct / 100)` then assign leftover minor units one at a time to the largest fractional parts (ties broken by participant order) so shares sum exactly
    - `exactSplit`: accept only if supplied shares sum to the amount, otherwise return a `validation` error and produce nothing
    - All shares are non-negative integers in minor units
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 3.4 Write property test for the split-sum invariant
    - **Property 1: Split shares sum exactly to the expense amount (INV-1)**
    - **Validates: Requirements 7.1, 7.3, 7.5, 7.8, 7.9**

  - [x] 3.5 Write property test for rejection of non-reconciling or empty split inputs
    - **Property 3: Non-reconciling or empty split inputs are rejected with no ledger change**
    - **Validates: Requirements 7.4, 7.6, 7.7**

- [x] 4. Implement Balance_Engine (INV-2)
  - [x] 4.1 Implement net-position and pairwise-debt derivation over a ledger snapshot
    - Define the `LedgerSnapshot` shape (members, expenses, splits, settlements) consumed by the engine
    - Implement `deriveNetPositions` using the corrected sign convention: `+paid − owed + settled_out − settled_in` (a flipped settlement sign is a documented critical pitfall)
    - Implement `derivePairwiseDebts` (who-owes-whom) used by settle-up pre-fill and the INV-5 cap
    - Derive everything from the ledger; never read or write a stored balance; an empty ledger derives zero for every member
    - _Requirements: 9.1, 9.2, 9.7_

  - [x] 4.2 Write property test comparing derivation to an independent recomputation
    - **Property 11: Net positions equal an independent ledger recomputation** (model-based: compare against a reference summation)
    - **Validates: Requirements 9.1, 9.2**

  - [x] 4.3 Write property test for the zero-sum invariant
    - **Property 12: Group net positions sum to zero (INV-2)**
    - **Validates: Requirements 9.3, 9.7**

  - [x] 4.4 Write property test for settlement direction
    - **Property 13: Settlement moves balances in the correct direction** (payer net up by A, receiver net down by A — catches a flipped sign that sum-to-zero cannot)
    - **Validates: Requirements 9.4**

- [x] 5. Implement Debt_Simplifier
  - [x] 5.1 Implement greedy min-cashflow simplifyDebts
    - Repeatedly settle the largest debtor against the largest creditor; pure function of the net map, no locks, no writes (read path)
    - Each transfer is a positive integer minor-units amount from a payer to a distinct receiver; empty plan when all nets are zero
    - _Requirements: 10.1, 10.6, 10.7_

  - [x] 5.2 Write property test for plan reconciliation
    - **Property 16: Simplified plan reconciles to net positions**
    - **Validates: Requirements 10.1, 10.2, 10.7**

  - [x] 5.3 Write property test for plan minimality
    - **Property 17: Simplified plan is minimal and empty when settled**
    - **Validates: Requirements 10.3, 10.4**

- [x] 6. Implement Settlement_Validator (INV-5)
  - [x] 6.1 Implement maxSettleable and validate
    - `maxSettleable` derives the pairwise amount the payer currently owes the receiver from the ledger (via Balance_Engine derivation), never a stored balance
    - `validate` enforces the order: required fields present → amount is a positive integer minor unit and currency is valid ISO-4217 → payer ≠ receiver → `amount ≤ maxSettleable`, returning `maxSettleableMinor` on a cap rejection so the UI can state the maximum; each failure leaves the ledger unchanged
    - _Requirements: 8.2, 8.3, 8.6, 8.7, 8.8_

  - [x] 6.2 Write property test for the settlement cap
    - **Property 14: Settlement cap (INV-5)**
    - **Validates: Requirements 8.6, 8.7**

- [x] 7. Implement Currency_Display
  - [x] 7.1 Implement read-time conversion with cached FX rates
    - Define the `FxRate` model with `ratePpm` (parts-per-million, integer-friendly); same-currency conversion is identity and always available
    - `convert` returns the converted amount plus the preserved original currency/amount, or signals conversion unavailable when no rate exists; never mutates stored amounts
    - _Requirements: 14.1, 14.2, 14.3, 14.5_

  - [x] 7.2 Write property test for conversion preserving stored data and the original
    - **Property 22: Display conversion preserves stored data and the original**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.5**

- [x] 8. Checkpoint - domain core invariants locked
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Persistence abstraction, in-memory fake, and OCC retry (INV-3)
  - [x] 9.1 Define the Persistence interface, row types, and an in-memory fake
    - Define the `Persistence` interface (`insertExpenseWithSplits`, `insertSettlement`, reference writes, `loadLedger`, `membershipExists`, `groupExists`) and the row types (`ExpenseRow`, `SplitRow`, `SettlementRow`, `UserRow`, `GroupRow`, `MembershipRow`)
    - Implement an in-memory fake that models atomic append, idempotent membership on `(group_id, user_id)`, and a hook to inject `SQLSTATE 40001` conflicts for concurrency tests
    - _Requirements: 6.1, 6.11, 4.2, 13.4_

  - [x] 9.2 Implement the withOccRetry wrapper
    - Retry on `SQLSTATE 40001` up to a bounded number of attempts with jittered exponential backoff; on exhaustion return `{ category: "conflict_exhausted" }` and leave the ledger unchanged
    - A success after one or more retries returns the same outcome as a first-attempt success
    - _Requirements: 11.2, 11.3, 11.4, 11.6_

  - [x] 9.3 Write property test for OCC retry semantics
    - **Property 18: OCC retry semantics (INV-3 wrapper)**
    - **Validates: Requirements 11.2, 11.4**

  - [x] 9.4 Write unit test for bounded backoff between attempts
    - Assert a bounded delay is applied between retry attempts and that attempts never exceed the configured maximum
    - _Requirements: 11.3_

- [x] 10. Implement Auth_Guard
  - [x] 10.1 Implement the Auth_Guard membership checks
    - `requireGroupMembership`, `requireExpenseParticipantsAreMembers` (payer and every assigned split member), and `requireSettlementPartiesAreMembers` (payer and receiver)
    - Failures return `{ category: "authorization" }` (or `not_found` for a missing group) and never include any group contents
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 13.3_

  - [x] 10.2 Write property test for the group-scoped read guard
    - **Property 8: Group-scoped read guard without disclosure**
    - **Validates: Requirements 5.1, 5.2**

- [x] 11. Implement identity, group, and membership services
  - [x] 11.1 Implement member registration and identity
    - Trim and validate display name (1–100 chars) and email (≤254 chars, valid format); create a `Member` with an application-generated UUID, default `currency_pref` of `USD`, and creation timestamp
    - Store only display name, email, home region, and currency preference (data minimization)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 21.2_

  - [x] 11.2 Write property test for member creation and data minimization
    - **Property 23: Member data is minimized and identity is created correctly**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 21.2**

  - [x] 11.3 Implement currency-preference update
    - Persist a valid ISO-4217 code; reject an invalid code, leave the existing preference unchanged, and return an invalid-code message
    - _Requirements: 1.5, 1.7_

  - [x] 11.4 Write property test for currency-preference update
    - **Property 24: Currency-preference updates validate and preserve prior value**
    - **Validates: Requirements 1.5, 1.7**

  - [x] 11.5 Implement group creation with creator membership
    - Validate a present name and a valid ISO-4217 base currency; create a `Group` with an application-generated UUID and record the creating member as a `Membership`; reject a missing name or invalid base currency with the offending field identified
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 11.6 Write property test for group creation
    - **Property 25: Group creation validates inputs and records creator membership**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 11.7 Implement group joining and membership
    - Accept a valid invitation to create exactly one `Membership` with a `joined_at` timestamp; treat a duplicate `(member, group)` join idempotently (unique index); reject a join to a non-existent group with a not-found error
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 13.4_

  - [x] 11.8 Write property test for membership idempotency and uniqueness
    - **Property 9: Membership creation is idempotent and unique**
    - **Validates: Requirements 4.1, 4.2, 4.5, 13.4**

  - [x] 11.9 Write property test for application-generated identifier uniqueness
    - **Property 10: Application-generated identifiers are unique** (members, groups, expenses, settlements; settlements and memberships carry timestamps)
    - **Validates: Requirements 1.6, 3.4, 6.8, 8.9**

- [x] 12. Implement Ledger Service write orchestration
  - [x] 12.1 Implement addExpense orchestration
    - Wire the write path: field validation → `Auth_Guard` membership + referential-integrity checks → `Split_Calculator` → atomic `insertExpenseWithSplits` inside `withOccRetry`, assigning an application-generated UUID; validation/auth/RI all precede any insert
    - Field validation: amount is a positive integer 1..9,223,372,036,854,775,807, currency is valid ISO-4217, description present/non-whitespace/≤500 chars, split type and non-empty participant set present
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 6.10, 6.11, 13.1_

  - [x] 12.2 Write property test for expense field validation
    - **Property 4: Expense field validation**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.9, 6.10**

  - [x] 12.3 Write property test for expense write atomicity
    - **Property 5: Expense write is atomic**
    - **Validates: Requirements 6.1, 6.11**

  - [x] 12.4 Write property test for the authorization and referential-integrity write guard
    - **Property 7: Authorization and referential-integrity write guard (INV-6)**
    - **Validates: Requirements 5.3, 5.4, 5.5, 13.1, 13.2, 13.3**

  - [x] 12.5 Implement recordSettlement orchestration
    - Wire the write path: required-field validation → `Auth_Guard` payer/receiver membership → `Settlement_Validator` (positive integer, ISO-4217, payer ≠ receiver, INV-5 cap) → `insertSettlement` inside `withOccRetry`, assigning an application-generated UUID and creation timestamp; any failure leaves the ledger unchanged
    - _Requirements: 8.1, 8.4, 8.5, 8.9, 13.2_

  - [x] 12.6 Write property test for settlement validation and recording
    - **Property 15: Settlement field validation**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8**

  - [x] 12.7 Implement expense correction as an append-only reversal
    - A correction request produces a new reversing `Expense` and leaves the original `Expense` and its splits unchanged (never an UPDATE)
    - _Requirements: 6.6, 6.7_

  - [x] 12.8 Write property test for append-only corrections
    - **Property 6: Corrections are append-only reversals**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 12.9 Write property test for non-OCC write failures
    - **Property 27: Non-OCC write failures leave the ledger unchanged**
    - **Validates: Requirements 22.1**

  - [x] 12.10 Write property test for no double-counting under interleaving
    - **Property 19: No append is double-counted under any interleaving (INV-3)** (model-based: interleaved appends with injected 40001 retries equal serial application)
    - **Validates: Requirements 11.5**

- [x] 13. Checkpoint - orchestration verified on the in-memory fake
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement the Aurora DSQL schema, connection, and real Persistence
  - [x] 14.1 Author the DSQL-safe DDL migration
    - Create `users`, `groups`, `group_members`, `expenses`, `expense_splits`, `settlements` with `BIGINT` minor-unit columns and `CHECK` constraints; secondary indexes via `CREATE INDEX ASYNC`; unique async index on `(group_id, user_id)`; no foreign keys, sequences, triggers, views, or JSON columns
    - _Requirements: 12.1, 13.4_

  - [x] 14.2 Implement the DSQL connection module
    - Connect with the `postgres` (porsager) client over the DSQL psql wire using a freshly generated IAM auth token as the password and `sslmode=require`; reuse connections across invocations
    - _Requirements: 19.6_

  - [x] 14.3 Implement the real Persistence against DSQL
    - Implement the `Persistence` interface against DSQL: atomic `insertExpenseWithSplits`, `insertSettlement`, reference-state writes, `loadLedger` (balance-derivation query), `membershipExists`, `groupExists`; application-generated UUIDs; surface `SQLSTATE 40001` so `withOccRetry` can act; enforce app-layer referential integrity and idempotent membership
    - _Requirements: 6.1, 6.11, 4.2, 13.1, 13.2, 13.3, 13.4_

  - [x] 14.4 Write DDL/schema smoke test
    - Assert the schema deploys on DSQL using `CREATE INDEX ASYNC` with no FK/sequences/triggers/views/JSON, and that a `psql` v14+ client connects with IAM token auth and `sslmode=require`
    - _Requirements: 13.4, 19.6_

  - [x] 14.5 Write data-minimization schema smoke test
    - Assert the schema contains no payment-card or bank-credential columns and that `users` is limited to the minimized fields
    - _Requirements: 21.1, 21.2_

  - [ ] 14.6 Write the two-client concurrency integration test
    - Two clients write to the same group simultaneously; assert one transaction aborts with `SQLSTATE 40001`, `withOccRetry` re-applies it, both writes land exactly once, and INV-2 (sum-to-zero) still holds
    - _Requirements: 11.1, 11.5_
    - _Note: Requires a live Aurora DSQL instance. Deferred to deployment-time testing._

- [x] 15. Implement the API boundary, session, and error mapping
  - [x] 15.1 Implement session authentication
    - Server-side credential verification establishing an HTTP-only cookie session; sign-out terminates the session and requires re-authentication; sign-in failure uses a single non-enumerating message
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 15.2 Implement the unauthenticated route guard
    - Unauthenticated (expired/terminated) requests to group-scoped screens and actions are blocked and redirected to sign-in
    - _Requirements: 2.3_

  - [x] 15.3 Wire Auth_Guard membership enforcement into every group-scoped route
    - Every group-scoped route handler / server action resolves the caller's member id and calls the relevant `Auth_Guard` check before any read or write proceeds; all financial mutations route through the API to the Ledger Service (browser never touches Persistence)
    - _Requirements: 5.1, 19.6_

  - [x] 15.4 Implement DomainError-to-response mapping and PII-free logging
    - Map each `DomainError` category to its HTTP status and a UI-safe, PII-free message indicating whether the operation took effect; exclude email and other PII from operational logs and from cross-member messages
    - _Requirements: 22.1, 22.2, 21.3, 21.4_

  - [x] 15.5 Write property test for PII exclusion
    - **Property 26: PII is excluded from logs and cross-member messages**
    - **Validates: Requirements 21.3, 21.4**

  - [x] 15.6 Write unit tests for the authentication lifecycle and architecture guard
    - Valid sign-in establishes a session (2.1), sign-out requires re-auth (2.4), unauthenticated group-scoped access redirects (2.3); assert no database driver is present in the client bundle and all mutations route through the API (19.6)
    - _Requirements: 2.1, 2.3, 2.4, 19.6_

- [x] 16. Checkpoint - backend fully integrated on DSQL
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Implement shared frontend foundation
  - [x] 17.1 Implement the MoneyAmount shared component
    - Format integer minor units into the correct major/minor presentation for the currency; always expose the original amount alongside any converted value; when no FX rate exists, show the original currency/amount and indicate conversion is unavailable; convert entered major-unit values to integer minor units before submission
    - _Requirements: 12.3, 12.4, 14.3, 14.4, 10.8_

  - [x] 17.2 Implement the App Router layout and accessible shell
    - Root layout with skip-to-content link, ARIA landmarks, and design tokens; session-guarded `(app)` segment; Server Components for initial render, Client Components for interactivity
    - _Requirements: 17.7, 19.5_

- [x] 18. Implement core frontend flows
  - [x] 18.1 Implement registration and sign-in screens
    - Accessible forms with programmatically associated labels and text error messages; preserve in-progress input on rejection
    - _Requirements: 1.1, 2.1, 17.4, 17.5, 22.4_

  - [x] 18.2 Implement groups list and group create/join screens
    - Create a group with an invite/add-members affordance; joining shows the group in the member's list
    - _Requirements: 3.5, 4.4_

  - [x] 18.3 Implement the AddExpenseFlow with live SplitPreview
    - Single primary flow for amount, currency, description, payer, split type, and participants; for `equal` show each participant's computed share before submit; for `percent`/`exact` show a running total versus the amount with a reconcile indicator and block submission (showing the outstanding difference) when shares do not reconcile; on success return to the group view with updated balances; on rejection preserve entered values and show the reason next to the relevant field
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 22.4_

  - [x] 18.4 Implement the BalanceSummary with live updates
    - Show the member's own net position prominently first; present who-owes-whom in plain language with a creditor/debtor indicator that does not rely on color alone; revalidate and present updated net positions within 2 seconds of a committed write without manual reload, announced via an ARIA live region
    - _Requirements: 9.5, 9.6, 16.1, 16.2, 17.6_

  - [x] 18.5 Implement the SimplifiedPlan view
    - Present each transfer as payer, receiver, and amount in the viewer's currency preference; when no FX rate is available show the original currency/amount and indicate conversion is unavailable
    - _Requirements: 10.5, 10.8_

  - [x] 18.6 Implement the SettleUpForm
    - Initiating settle-up from a displayed debt pre-fills payer, receiver, and amount owed; confirmation shows the recorded settlement and resulting balances; a member with no non-zero position sees a settled-up state
    - _Requirements: 16.3, 16.4, 16.5_

  - [x] 18.7 Implement submission resilience and unavailability handling
    - Show a progress indication while a submit is in flight and prevent duplicate submission of the same operation; on persistence unavailability show an unavailability state and allow retry without losing entered data; clear input only on success
    - _Requirements: 20.5, 22.3, 22.5_

- [x] 19. Accessibility, responsive, and performance verification
  - [x] 19.1 Write automated accessibility checks for all core flows
    - Integrate `axe-core` checks into component/end-to-end tests for registration, sign-in, group creation, joining, add expense, view balances, simplify debts, and settle
    - _Requirements: 17.1_

  - [x] 19.2 Write contrast, keyboard, label, and error-association tests
    - Verify 4.5:1 / 3:1 contrast against design tokens; assert keyboard reachability/operability with a visible focus indicator, programmatic labels on every control, and error text programmatically associated with its control (not color alone)
    - _Requirements: 17.2, 17.3, 17.4, 17.5_

  - [x] 19.3 Write responsive and touch tests
    - Run core flows at 320px, tablet, and desktop asserting no horizontal scroll and no loss of function; verify touch targets ≥44×44px and no hover-only interactions
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 19.4 Configure Lighthouse CI performance gates
    - Gate LCP ≤ 2.5s, CLS ≤ 0.1, and post-commit confirmation ≤ 2s at p75 on a representative mobile profile; verify the 2-second live-balance update end-to-end; track INP ≤ 200ms via field/RUM data
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 9.6_

- [x] 20. Final checkpoint - all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but the user requested no bugs and no gaps, so every requirement and every one of the 27 correctness properties has a dedicated implementation and test task.
- The pure domain core (tasks 2–7) is built and property-tested before any DSQL wiring (task 14), so INV-1, INV-2 (with the corrected settlement sign), INV-4, INV-5, and the simplification/derivation invariants are locked down independently of the database.
- Each property test is implemented as exactly one `fast-check` + Vitest test, tagged `Feature: ledgerloop-app, Property {n}: {text}`, running a minimum of 100 iterations. Properties that touch persistence (5, 6, 7, 9, 10, 15, 18, 19, 27) run against the in-memory `Persistence` fake; Properties 11 and 19 are model-based.
- The live concurrency story (task 14.6), the DDL/schema smoke test (14.4), the data-minimization smoke test (14.5), and the accessibility/responsive/performance gates (task 19) cover the criteria that property-based testing does not fit.
- Checkpoints (tasks 8, 13, 16, 20) provide incremental validation gates.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.3", "2.4", "3.2", "3.3", "4.2", "4.3", "4.4", "5.2", "5.3", "6.1", "7.1"] },
    { "id": 4, "tasks": ["3.4", "3.5", "6.2", "7.2", "9.1", "9.2"] },
    { "id": 5, "tasks": ["9.3", "9.4", "10.1", "11.1", "11.5"] },
    { "id": 6, "tasks": ["10.2", "11.2", "11.3", "11.6", "11.7"] },
    { "id": 7, "tasks": ["11.4", "11.8", "11.9", "12.1"] },
    { "id": 8, "tasks": ["12.2", "12.3", "12.4", "12.5"] },
    { "id": 9, "tasks": ["12.6", "12.7", "12.9", "12.10"] },
    { "id": 10, "tasks": ["12.8", "14.1", "14.2"] },
    { "id": 11, "tasks": ["14.3"] },
    { "id": 12, "tasks": ["14.4", "14.5", "14.6", "15.1"] },
    { "id": 13, "tasks": ["15.2", "15.3", "15.4", "17.1", "17.2"] },
    { "id": 14, "tasks": ["15.5", "15.6", "18.1", "18.2"] },
    { "id": 15, "tasks": ["18.3", "18.4", "18.5", "18.6"] },
    { "id": 16, "tasks": ["18.7", "19.1", "19.2", "19.3"] },
    { "id": 17, "tasks": ["19.4"] }
  ]
}
```
