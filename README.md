# LedgerLoop

**Multi-region group expense ledger where shared balances stay correct even when group members in different regions edit simultaneously.**

Built for the H0 Hackathon ("Hack the Zero Stack")  AWS + Vercel | Deadline: June 30, 2026.

> "We didn't pick Aurora DSQL because it's new  we picked it because a group ledger has a correctness invariant that eventual consistency physically cannot hold, and DSQL aborts the conflicting write instead of silently corrupting the balance."

---

## What it does

LedgerLoop tracks and simplifies shared expenses across groups of people in different countries. Three friends across three continents split a trip  two add an expense at the same second  and the balance never silently breaks.

**Core features:**
- **Expense splitting**  equal, percentage, or exact amounts with deterministic rounding (₦1,000 ÷ 3 = 334 + 333 + 333, never 999)
- **Debt simplification**  reduces N tangled debts to the minimum number of payments (greedy min-cashflow algorithm)
- **Settlement recording**  mark payments with a cap that prevents over-settling
- **Multi-currency display**  store in original currency, convert at read time to each member's preference
- **Concurrency correctness**  simultaneous edits from different regions never corrupt balances (DSQL OCC + retry)

**What it does NOT do (MVP scope):** move real money. It tracks and simplifies debt only.

---

## Architecture

A layered serverless monolith: one Next.js deploy artifact on Vercel, one Aurora DSQL database.

```
Browser (Lagos / London / Toronto)
    │
    ▼
Vercel  Next.js App Router
    ├── Server Components (initial render)
    ├── Client Components (live balances, forms)
    └── Route Handlers / Server Actions (API boundary)
            │
            ▼
        Ledger Service (domain core  all writes + derivation)
            ├── Auth_Guard (membership enforcement)
            ├── Split_Calculator (INV-1: shares sum to amount)
            ├── Balance_Engine (INV-2: group balances sum to zero)
            ├── Debt_Simplifier (greedy min-cashflow)
            ├── Settlement_Validator (INV-5: cap at what's owed)
            ├── Currency_Display (read-time FX conversion)
            └── withOccRetry (INV-3: no double-counting)
                    │
                    ▼
            Aurora DSQL (single logical DB)
                Append-only ledger: expenses, splits, settlements
                Reference state: users, groups, memberships
                Snapshot isolation + OCC (SQLSTATE 40001)
```

**Why this architecture:**
- Balance is an OUTPUT, not state  derived from the immutable ledger on every read
- Writes only append rows, so conflicts collide on inserts where DSQL's OCC protects you
- Single database = no cross-service saga to get wrong
- The browser never touches persistence directly (Req 19.6)

---

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict mode, type-check enforced in build) |
| Styling | Tailwind CSS with shared design tokens |
| Components | Radix UI accessible headless primitives |
| Database | Aurora DSQL (single region, free tier) |
| DB Driver | `postgres` (porsager) over DSQL psql wire |
| Auth | Session-based (HTTP-only cookie, HMAC-SHA256 hashing) |
| Connection | IAM token auth via `@aws-sdk/dsql-signer`, sslmode=require |
| Hosting | Vercel |
| Testing | Vitest + fast-check (property-based, 100+ iterations) + axe-core |
| Performance | Lighthouse CI gates (LCP ≤ 2.5s, CLS ≤ 0.1) |

---

## Project Structure

```
src/
├── app/                    Next.js App Router
│   ├── (auth)/             Registration + sign-in (unauthenticated)
│   ├── (app)/              Session-guarded app segment
│   │   └── groups/         Group list, create, view, add-expense, settle
│   ├── layout.tsx          Root layout (ARIA landmarks, skip-to-content)
│   └── globals.css         Tailwind base styles
├── components/
│   ├── ui/                 MoneyAmount, MoneyInput, SubmitButton, Label
│   ├── expense/            AddExpenseFlow (live split preview)
│   ├── balance/            BalanceSummary, SimplifiedPlan
│   └── settle/             SettleUpForm
├── design/
│   └── tokens.ts           Color, typography, spacing (single source of truth)
├── domain/                 Pure domain core (no I/O, property-tested)
│   ├── types.ts            SplitType, Split, ExpenseInput, Transfer, Result<T>
│   ├── result.ts           DomainError model + ok/err helpers
│   ├── money.ts            ISO-4217 validation, parseMajorToMinor, formatMinor
│   ├── split-calculator.ts equalSplit, percentSplit, exactSplit (INV-1)
│   ├── balance-engine.ts   deriveNetPositions, derivePairwiseDebts (INV-2)
│   ├── debt-simplifier.ts  simplifyDebts (greedy min-cashflow)
│   ├── settlement-validator.ts  maxSettleable, validate (INV-5)
│   └── currency-display.ts convert (read-time FX, never mutates stored data)
├── ledger/                 Orchestration + persistence
│   ├── persistence.ts      Persistence interface + row types
│   ├── in-memory-persistence.ts  In-memory fake (for tests + local dev)
│   ├── occ-retry.ts        withOccRetry (bounded, jittered backoff)
│   ├── auth-guard.ts       Membership enforcement (INV-6)
│   ├── services.ts         registerMember, createGroup, joinGroup
│   ├── orchestration.ts    addExpense, recordSettlement, correctExpense
│   └── dsql/               Real Aurora DSQL implementation
│       ├── schema.sql      DSQL-safe DDL (CREATE INDEX ASYNC, no FK)
│       ├── connection.ts   IAM token auth, sslmode=require, pooling
│       └── dsql-persistence.ts  Full Persistence implementation
└── lib/                    API boundary utilities
    ├── auth.ts             Session management (HTTP-only cookie)
    ├── auth-store.ts       Credential store (separate from users table)
    ├── route-guard.ts      Unauthenticated request blocking
    ├── group-route-handler.ts  Session + Auth_Guard wiring
    ├── api-response.ts     DomainError → HTTP status mapping
    └── logger.ts           PII-free logging (strips email addresses)

test/
├── helpers/                Property-test helper (≥100 iterations) + generators
├── domain/                 12 property tests (INV-1, INV-2, INV-4, INV-5, ...)
├── ledger/                 OCC retry, auth-guard, services, orchestration tests
├── api/                    PII exclusion + auth lifecycle tests
└── frontend/              Accessibility (axe-core), contrast, responsive, touch
```

---

## Correctness Invariants

The system enforces six invariants  each property-tested to 100+ iterations:

| # | Invariant | Enforced by |
|---|-----------|-------------|
| INV-1 | Σ(splits) == expense amount | Split_Calculator + atomic transaction |
| INV-2 | Σ(balances) across a group == 0 | Balance_Engine derivation |
| INV-3 | No double-counting under concurrency | DSQL OCC (40001) + withOccRetry |
| INV-4 | Money is always integer minor units | BIGINT storage + no-float discipline |
| INV-5 | Settlement ≤ what's owed | Settlement_Validator against derived ledger |
| INV-6 | Every row references real entities | Auth_Guard + app-layer referential checks |

**27 correctness properties** are tested with fast-check (property-based testing), each running a minimum of 100 iterations. The settlement direction property explicitly catches a flipped sign that a sum-to-zero check alone cannot detect.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18.18.0
- npm

### Local Development (no database needed)

```bash
# Install dependencies
npm install

# Run tests (138 tests, 24 files  all pass without a database)
npm test

# Type-check
npm run typecheck

# Start dev server (uses in-memory persistence)
npm run dev
```

The app runs fully locally against the `InMemoryPersistence` fake. No AWS account or DSQL cluster is needed for development or testing.

### With Aurora DSQL (production)

```bash
# Set environment variables
export DSQL_HOST=<cluster-id>.dsql.<region>.on.aws
export DSQL_REGION=us-east-1

# Run the schema migration (requires psql v14+ for SNI)
TOKEN=$(aws dsql generate-db-connect-admin-auth-token \
  --hostname $DSQL_HOST --region $DSQL_REGION)

psql "host=$DSQL_HOST port=5432 dbname=postgres user=admin \
  password=$TOKEN sslmode=require" -f src/ledger/dsql/schema.sql

# Start with real persistence
npm run dev
```

---

## Deployment

### Strategy: Git push → Vercel auto-deploys → DSQL via Marketplace

1. **Provision DSQL**  Use the [Vercel Marketplace → AWS DSQL](https://vercel.com/marketplace/aws/aws-dsql) integration. It provisions a cluster and auto-injects `DSQL_HOST`/`DSQL_REGION` via OIDC (no static secrets).

2. **Run the DDL**  Connect with psql v14+ and run `src/ledger/dsql/schema.sql`.

3. **Deploy**  Push to GitHub. Vercel auto-builds and deploys. Or: `npx vercel --prod`.

4. **Verify**  Register, create a group, add an expense, check balances sum to zero. Fire two simultaneous writes to capture the 40001 → retry in logs.

### Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `DSQL_HOST` | DSQL cluster endpoint | Vercel Marketplace (auto) or manual |
| `DSQL_REGION` | AWS region | Vercel Marketplace (auto) or manual |

No other secrets needed  IAM tokens are generated at runtime via `@aws-sdk/dsql-signer`.

### Cost

$0/month on the hackathon. DSQL free tier: 100K DPU + 1 GiB storage. Vercel hobby/pro covered by hackathon credits.

---

## Testing

```bash
# Run all tests (property-based + unit + accessibility + responsive)
npm test

# Watch mode
npm run test:watch

# Lighthouse CI (requires a built/deployed app)
npm run lighthouse
```

**Test coverage:**
- 24 test files, 138 tests
- 27 property-based tests (fast-check, ≥100 iterations each)
- 12 axe-core accessibility checks (zero violations)
- 18 contrast/keyboard/label/error-association tests
- 13 responsive/touch structural tests
- Lighthouse CI gates configured (LCP, CLS, performance score)

---

## Accessibility

- WCAG 2.1 AA compliance across all core flows
- Every form control has a programmatically associated label
- Errors conveyed through text (aria-describedby), not color alone
- Creditor/debtor status uses text labels + icons, never color alone
- Skip-to-content link, ARIA landmarks (banner, navigation, main, contentinfo)
- Touch targets ≥ 44×44px, no hover-only interactions
- Live balance updates announced via aria-live="polite" region
- Contrast ratios verified against design tokens (4.5:1 / 3:1 minimums)

---

## Key Design Decisions

1. **Balance is derived, never stored**  prevents the classic lost-update bug under concurrency
2. **Append-only ledger**  expenses and settlements are immutable inserts; corrections are reversals
3. **Integer minor units everywhere**  no floating point, not even for zero (BIGINT in DB, `number`/`bigint` in TS)
4. **Validation precedes side effects**  a rejected operation never partially writes
5. **OCC is invisible on success**  retries happen transparently; only exhaustion surfaces as an error
6. **Single database**  INV-3 is a database guarantee (OCC), not application coordination
7. **Pure domain core tested independently**  invariants are proven before any database exists

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build (typecheck + lint enforced) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict type-check |
| `npm test` | Run all tests (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run lighthouse` | Lighthouse CI performance gates |

---

## Hackathon Submission

- **Track:** AWS Aurora DSQL
- **Pitch:** A group ledger has a correctness invariant (balances sum to zero, no double-counting) that eventual consistency physically cannot hold. DSQL's snapshot isolation + OCC makes the conflict impossible to ignore  it surfaces as a retryable error rather than silent corruption.
- **Demo:** Two simultaneous writes → one gets 40001 → retry succeeds → both land → INV-2 holds. "12 debts → 4 payments" in the UI.
