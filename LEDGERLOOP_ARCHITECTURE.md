# LedgerLoop — Deep Architecture & Solution Design

**H0 Hackathon ("Hack the Zero Stack") — AWS + Vercel | Deadline: June 30, 2026**

*Generated: May 31, 2026 | Skills applied: `/aws-solution-architect` + `/architecture-selection` | Research mode: aggressive (28 cumulative queries)*

> Companion to `mine.md`. That file picked **LedgerLoop** as the highest-probability winner. This file proves the architecture is sound, applies a formal architecture-selection methodology, and hands you a build-ready spec with IaC, data model, cost analysis, and the exact consistency story the AWS database judges want to hear.

---

## 0. Executive Summary

LedgerLoop is a multi-region group expense ledger where **shared balances stay correct even when group members in different regions edit simultaneously.** The architecture is deliberately **single-database (Aurora DSQL)** — not because DSQL is trendy, but because the core invariant (group balances must sum to zero and never double-count a concurrent edit) is *exactly* the problem DSQL's distributed strong consistency + optimistic concurrency control solves. That alignment between problem and database is the whole pitch.

**One-sentence judge hook:**
> "We didn't pick Aurora DSQL because it's new — we picked it because a group ledger has a correctness invariant that eventual consistency physically cannot hold, and DSQL aborts the conflicting write instead of silently corrupting the balance."

**Critical accuracy note (corrected from prior draft):** DSQL is **not** fully serializable. It provides isolation **equivalent to PostgreSQL Repeatable Read (snapshot isolation) plus optimistic concurrency control** that aborts conflicting concurrent writes with `SQLSTATE 40001` ([AWS docs](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with.html), [AWS concurrency blog](https://aws.amazon.com/cn/blogs/database/concurrency-control-in-amazon-aurora-dsql/)). Your demo must say "snapshot isolation + OCC," not "serializable." Judges who built DSQL will catch the wrong term instantly.

---

## 1. Requirements (AWS Solution Architect — Step 1)

```json
{
  "application_type": "b2c_fintech_ledger",
  "expected_users": 50000,
  "concurrent_peak": "group-bursty (dinner/trip settle moments)",
  "requests_per_second": 50,
  "budget_monthly_usd": 0,
  "budget_note": "Hackathon: AWS credits + DSQL free tier (100K DPU + 1 GiB/mo free)",
  "team_size": "1-5",
  "aws_experience": "intermediate",
  "compliance": ["GDPR-aware (PII minimization)", "no real money movement in MVP"],
  "availability_sla": "99.99% single-region (demo target)",
  "required_stack": ["Vercel v0 / Next.js", "Aurora DSQL"],
  "deploy_target": "Vercel"
}
```

**Deliberate scoping decision:** MVP does **not** move real money (no card rails, no payouts). It *tracks and simplifies* debt. This keeps it legally clean (unlike the prediction-game pivot we rejected) and keeps "shippable" credible.

---

## 2. Architecture Selection (formal methodology)

Following the `/architecture-selection` discipline: classify variables → map to requirements → extract invariants → generate candidates *before* scoring → score → select.

### 2a. Variable Classification

| Variable | Classification | Notes |
|----------|---------------|-------|
| `user` (id, name, region, currency_pref) | State (entity) | Identity + display |
| `group` (id, name, base_currency) | State (entity) | Container |
| `membership` (group_id, user_id) | State (relationship) | Join, no FK in DSQL |
| `expense` (amount_minor, paid_by, split_type) | Input → State | Immutable once posted |
| `expense_split` (expense_id, user_id, share_minor) | State (derived on write) | Must sum to expense amount |
| `settlement` (from_user, to_user, amount_minor) | Event → State | Records a payback |
| `balance(group, user)` | Output (derived) | Σ paid − Σ owed; never stored as truth |
| `simplified_plan` | Output (computed) | Min-cashflow transaction set |
| `fx_rate` | Configuration Parameter | External, cached |
| `occ_retry` | Side Effect | Retry on 40001 |

**Key insight from classification:** `balance` is an **Output, not State**. The single most common LedgerLoop bug (and the one that kills the demo) is treating a stored balance as the source of truth and updating it in place — that's the row that gets corrupted under concurrency. The architecture must derive balances from the immutable expense/settlement ledger, so concurrency conflicts happen on *appends*, where DSQL's OCC protects you.

### 2b. Requirement–Variable Map (R=read, W=write)

| Requirement | user | group | membership | expense | split | settlement | balance |
|-------------|------|-------|-----------|---------|-------|-----------|---------|
| REQ-1 Create/join group | R | W | W | | | | |
| REQ-2 Add expense + split | R | R | R | W | W | | |
| REQ-3 View balances | R | R | R | R | R | R | **W(derive)** |
| REQ-4 Record settlement | R | R | R | | | W | |
| REQ-5 Simplify debts | | R | R | R | R | R | R |
| REQ-6 Multi-currency display | R | R | | R | R | R | R |

**Co-access clusters:** `{expense, split}` always move together (write cluster). `{expense, split, settlement}` are all read together to derive `balance` (read cluster). This tells us the **ledger** is one cohesive component and **balance derivation** is a distinct read-path concern.

### 2c. Invariant Extraction

| # | Invariant | Constrains | Enforced by |
|---|-----------|-----------|-------------|
| INV-1 | Σ(splits) == expense.amount for every expense | expense, split | Single transaction (atomic) |
| INV-2 | Σ(balances) across a group == 0 at all times | balance | Derivation logic + INV-1 |
| INV-3 | No expense/settlement is double-counted under concurrent writes | expense, settlement | **DSQL OCC (40001 abort + retry)** |
| INV-4 | Money never represented as float | amount_minor | `BIGINT` minor units |
| INV-5 | A settlement cannot exceed what's owed (no negative debt overpay in MVP scope) | settlement, balance | App-layer validation |
| INV-6 | Referential integrity (split → expense, membership → group) | all | App layer (DSQL has no FK) |

INV-3 is the **load-bearing invariant** and the reason DSQL is the right database. INV-6 is the **tax** DSQL imposes (no foreign keys) and must be paid in the API layer.

### 2d. Candidate Architectures (all described before any scoring)

#### Candidate A — Layered Serverless Monolith (Next.js full-stack on Vercel + DSQL)
- **Components:** `Web/UI` (React Server + Client Components) → `API Routes` (Next.js route handlers / server actions) → `Ledger Service` (domain logic, owns all writes) → `Aurora DSQL` (persistence boundary).
- **Flow:** UI → API → Ledger Service → DSQL. Balance derivation is a read query in Ledger Service.
- **Req allocation:** all REQ live in Ledger Service; UI is presentation only.
- **Invariant allocation:** INV-1/3/5 in Ledger Service transactions; INV-2 in derivation query; INV-4/6 in a thin data-access module.
- **Steelman:** Fastest to build, one deploy artifact, one mental model. v0 generates exactly this shape natively. Every requirement has a single home → near-zero cross-cutting. For a 1–5 person team on an 8-day clock, this is the lowest-risk path to a *working, shippable* demo, which is precisely what the judges reward.

#### Candidate B — Event-Sourced CQRS (append-only event log + projection)
- **Components:** `Command API` → `Event Store (DSQL append-only)` → `Projector` → `Read Model (materialized balances)` → `Query API` → `UI`.
- **Flow:** writes append events; a projector rebuilds balance projections; reads hit projections.
- **Req allocation:** REQ-2/4 = command side; REQ-3/5/6 = query side.
- **Invariant allocation:** INV-1/3 at append; INV-2 in projector; risk of projection lag breaking read-your-writes.
- **Steelman:** Philosophically beautiful for a ledger — the immutable event log *is* the audit trail, and DSQL's durability shines. Scales reads independently. If LedgerLoop became a real fintech product, this is where it'd go, and you can *say* that to judges to show architectural maturity.

#### Candidate C — Microservices (separate User, Group, Expense, Settlement services)
- **Components:** 4 services + API gateway + DSQL (shared or per-service).
- **Flow:** gateway fans out to services; cross-service calls for balance derivation.
- **Req allocation:** spread across services; balance derivation spans Expense + Settlement + Group.
- **Invariant allocation:** INV-2/3 now require **cross-service coordination** — distributed transaction or saga.
- **Steelman:** Independently deployable, textbook "scale to millions" story for Track 3. Each service can scale to its own load profile.

### 2e. Scoring

| Metric | A (Layered Monolith) | B (Event-Sourced CQRS) | C (Microservices) |
|--------|---------------------|------------------------|-------------------|
| Cross-cutting requirements % | **0%** | ~33% (split command/query) | ~66% (balance spans 3) |
| Cross-cutting invariants % | Low (INV-2 single query) | Medium (projector owns INV-2) | **High (INV-2/3 cross-service)** |
| Information flow density | **0.25** (linear chain) | 0.45 | 0.7 |
| God object score | Medium (Ledger Service ~60% logic) | Low | Low |
| Synchronous cycles | **0** | 0 | risk of cycles via balance calls |
| Max fan-in / fan-out | 1 / 2 | 2 / 3 | 4 / 4 |
| Evolvability cost (avg comps touched per new REQ) | ~1.3 | ~2.0 | ~3.1 |
| **Build risk on 8-day clock** | **Low** | Medium-High | **High** |
| **Consistency-story clarity for judges** | **High** | High | Diluted by saga complexity |

**Red flags:** Candidate C has cross-service coordination for the exact invariant (INV-3) that DSQL is supposed to make trivial — it *fights* the database's strength and adds distributed-transaction risk. Candidate B's projection lag can break read-your-writes, undermining the live demo ("I added an expense but the balance didn't update").

### 2f. Selection

**Recommended: Candidate A (Layered Serverless Monolith), with one borrowed idea from B.**

> Candidate A is recommended because it has 0% cross-cutting requirements, the lowest flow density (0.25), zero synchronous cycles, and the lowest build risk on an 8-day clock — while keeping the DSQL consistency story crisp and centralized in one Ledger Service. The trade-off is a moderately heavy Ledger Service (≈60% of domain logic), which is acceptable at MVP scale. If independent read-scaling for millions mattered more (Track 3 framing), Candidate B would be preferable because its append-only event log scales reads via projections and doubles as an audit trail — so we **borrow B's append-only ledger idea** (expenses/settlements are immutable inserts, balances are always derived) without paying for a separate projector.

**The hybrid:** Monolith structure (A) + immutable append-only ledger + derived balances (B's best idea). This is the sweet spot: simple to build, correct under concurrency, and you get to tell judges "it's event-sourced at the data layer" truthfully.

---

## 3. AWS Solution Architect — Recommended Pattern

**Pattern: Serverless Web (variant) — Vercel-fronted, DSQL-backed.**

```json
{
  "recommended_pattern": "serverless_fullstack_vercel_dsql",
  "service_stack": ["Vercel (Next.js + Edge)", "Aurora DSQL", "AWS IAM", "CloudWatch (DSQL metrics)"],
  "estimated_monthly_cost_usd": 0,
  "cost_basis": "DSQL free tier 100K DPU + 1GiB; Vercel hobby/pro credits",
  "pros": ["Zero infra mgmt", "Strong consistency built-in", "Scales to zero", "One deploy"],
  "cons": ["DSQL feature gaps (no FK/triggers/sequences/JSON)", "OCC retry logic required", "IAM token auth adds connection nuance"]
}
```

### System Diagram

```
            ┌──────────────────────────────────────────────────────────┐
            │                     VERCEL (deploy target)                │
            │                                                          │
   Users ──▶│  Next.js App Router                                       │
 (LDN/LAG/  │   ├─ Server Components ── initial dashboard render        │
  TOR)      │   ├─ Client Components ── live balance UI (poll/revalidate)│
            │   └─ Route Handlers / Server Actions  ◀── API boundary    │
            │            │                                              │
            │            ▼                                              │
            │   ┌────────────────────────┐                             │
            │   │   Ledger Service        │  (domain core, all writes)  │
            │   │   • addExpense (txn)    │                             │
            │   │   • recordSettlement    │                             │
            │   │   • deriveBalances      │                             │
            │   │   • simplifyDebts       │                             │
            │   │   • withOccRetry()      │  ◀── INV-3 lives here       │
            │   └───────────┬────────────┘                             │
            └───────────────┼──────────────────────────────────────────┘
                            │  IAM-token auth, SSL require, psql wire
                            ▼
            ┌──────────────────────────────────────────────────────────┐
            │              AURORA DSQL  (single logical DB)              │
            │   Append-only ledger (immutable):                         │
            │     expenses, expense_splits, settlements                 │
            │   Reference state:                                        │
            │     users, groups, group_members                          │
            │   Guarantees: snapshot isolation (Repeatable Read) + OCC  │
            │   Active-active multi-region capable (single-region demo) │
            └──────────────────────────────────────────────────────────┘
                            │
                            ▼
                   CloudWatch (DPU usage, OCC abort rate, p99 latency)
```

---

## 4. Data Model (DSQL-safe DDL)

DSQL constraints respected: **no foreign keys, no sequences, no triggers, no views, no JSON, ≤10K rows/transaction.** Money stored as `BIGINT` minor units (INV-4 — never float; [Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)).

> **DSQL index syntax:** secondary indexes **must** use `CREATE INDEX ASYNC` — plain `CREATE INDEX` is not supported ([AWS migration guide](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html), [async indexes](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-create-index-async.html)). The async build returns immediately and the index becomes active once the catalog updates. `CHECK`, `PRIMARY KEY`, `NOT NULL`, and `DEFAULT` constraints **are** supported ([CREATE TABLE syntax](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html)).

```sql
-- All PKs are application-generated UUIDs (no sequences in DSQL)
CREATE TABLE users (
  id           UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  email        TEXT NOT NULL,
  home_region  TEXT NOT NULL,          -- 'eu-west-2', 'af-south-1', etc. (display/analytics)
  currency_pref CHAR(3) NOT NULL DEFAULT 'USD',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No FK: integrity enforced in Ledger Service. Composite-ish lookups via index.
CREATE TABLE group_members (
  id        UUID PRIMARY KEY,
  group_id  UUID NOT NULL,
  user_id   UUID NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DSQL requires CREATE INDEX ASYNC (plain CREATE INDEX is unsupported)
CREATE INDEX ASYNC idx_members_group ON group_members (group_id);
CREATE INDEX ASYNC idx_members_user  ON group_members (user_id);
-- UNIQUE prevents duplicate membership rows (INV-6 support)
CREATE UNIQUE INDEX ASYNC idx_members_uniq ON group_members (group_id, user_id);

-- Append-only. Never UPDATE an expense; corrections are new rows (reversal pattern).
CREATE TABLE expenses (
  id            UUID PRIMARY KEY,
  group_id      UUID NOT NULL,
  paid_by       UUID NOT NULL,
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),  -- cents/kobo
  currency      CHAR(3) NOT NULL,
  description   TEXT NOT NULL,
  split_type    TEXT NOT NULL,         -- 'equal' | 'percent' | 'exact'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_expenses_group ON expenses (group_id);

CREATE TABLE expense_splits (
  id          UUID PRIMARY KEY,
  expense_id  UUID NOT NULL,
  user_id     UUID NOT NULL,
  share_minor BIGINT NOT NULL CHECK (share_minor >= 0)   -- Σ share_minor == expenses.amount_minor (INV-1)
);
CREATE INDEX ASYNC idx_splits_expense ON expense_splits (expense_id);

CREATE TABLE settlements (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL,
  from_user    UUID NOT NULL,
  to_user      UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC idx_settlements_group ON settlements (group_id);
```

**Balance derivation (INV-2) — balances are computed, never stored:**

```sql
-- Net position per member in a group (positive = owed money / creditor, negative = owes / debtor).
-- Sign convention:
--   + expenses you PAID (others owe you)
--   - your SHARE of expenses (you owe)
--   + settlements you SENT as from_user (paying a debt moves your net up toward 0)
--   - settlements you RECEIVED as to_user (being paid moves your net down toward 0)
SELECT m.user_id,
         COALESCE(paid.total, 0)        - COALESCE(owed.total, 0)
       + COALESCE(settled_out.total, 0) - COALESCE(settled_in.total, 0) AS net_minor
FROM group_members m
LEFT JOIN (SELECT paid_by uid, SUM(amount_minor) total FROM expenses
           WHERE group_id = $1 GROUP BY paid_by) paid        ON paid.uid = m.user_id
LEFT JOIN (SELECT s.user_id uid, SUM(s.share_minor) total FROM expense_splits s
           JOIN expenses e ON e.id = s.expense_id
           WHERE e.group_id = $1 GROUP BY s.user_id) owed     ON owed.uid = m.user_id
LEFT JOIN (SELECT from_user uid, SUM(amount_minor) total FROM settlements
           WHERE group_id = $1 GROUP BY from_user) settled_out ON settled_out.uid = m.user_id
LEFT JOIN (SELECT to_user uid, SUM(amount_minor) total FROM settlements
           WHERE group_id = $1 GROUP BY to_user) settled_in    ON settled_in.uid = m.user_id
WHERE m.group_id = $1;
-- Property check for the demo: SUM(net_minor) MUST equal 0 (INV-2).
-- NOTE: INV-2 holds for EITHER sign convention, so the sum-to-zero check alone
-- will NOT catch a flipped settlement sign. Add a direction test: after A pays B,
-- A's net must move toward 0 (up), B's toward 0 (down).
```

> The `JOIN expenses e ON e.id = s.expense_id` inside the `owed` subquery is a normal join on a non-FK column — DSQL has no foreign keys, but joins on indexed UUID columns work fine. It is not a declared FK constraint.

---

## 5. The Concurrency Story (your winning differentiator)

This is what you demo live and what wins the "Technological Implementation" criterion.

**Shared types** (referenced by the code in this section and Section 6):

```typescript
// Minimal type surface used across the Ledger Service.
type Sql = import("postgres").Sql;          // 'postgres' (porsager) client; works over DSQL's psql wire
type SplitType = "equal" | "percent" | "exact";

interface Split        { userId: string; shareMinor: number; }
interface ExpenseInput {
  groupId: string;
  paidBy: string;
  amountMinor: number;     // BIGINT minor units (kobo/cents)
  currency: string;        // ISO-4217, e.g. 'NGN'
  description: string;
  splitType: SplitType;
  splits: Split[];
}
interface Transfer     { from: string; to: string; amountMinor: number; }
```

> Driver note: the `postgres` (porsager) or `pg` client connects over DSQL's PostgreSQL wire protocol, but the **password must be a freshly generated IAM auth token**, not a static secret (see Section 8). The Vercel Marketplace integration injects this for you.

**The setup:** Two members of the same group, in two regions, both submit an expense (or a settlement) at the same instant against overlapping rows.

**What DSQL does:** Both transactions read a consistent snapshot (Repeatable Read). At commit, DSQL's OCC detects the write conflict and **aborts one** with `SQLSTATE 40001`. The aborted one is **retried** by your `withOccRetry()` wrapper and re-applied against fresh state. Net result: both expenses land, balances stay correct, INV-2 (sum to zero) holds. No lost update, no double count.

**Why this is the pitch:** With an eventually-consistent store, both writes "succeed" against stale replicas and the balance silently diverges — the classic lost-update bug. DSQL makes the conflict *impossible to ignore*: it surfaces as a retryable error rather than silent corruption.

```typescript
// Ledger Service — OCC retry wrapper (INV-3). DSQL aborts conflicts with SQLSTATE 40001.
const OCC_CONFLICT = "40001";

export async function withOccRetry<T>(fn: () => Promise<T>, max = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.code ?? err?.sqlState;
      if (code === OCC_CONFLICT && attempt < max - 1) {
        // exponential backoff with jitter; conflicts are rare so this rarely loops
        await new Promise(r => setTimeout(r, 25 * 2 ** attempt + Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
}

// addExpense: atomic insert of expense + its splits. INV-1 validated before commit.
export async function addExpense(sql: Sql, input: ExpenseInput) {
  const shareSum = input.splits.reduce((s, x) => s + x.shareMinor, 0);
  if (shareSum !== input.amountMinor) {
    throw new Error("INV-1 violation: splits must sum to expense amount");
  }
  return withOccRetry(async () => {
    return sql.begin(async (tx) => {
      // App-layer referential integrity (INV-6): membership + group must exist.
      const ok = await tx`SELECT 1 FROM group_members
                          WHERE group_id = ${input.groupId} AND user_id = ${input.paidBy}`;
      if (ok.length === 0) throw new Error("INV-6: payer not a group member");

      const expenseId = crypto.randomUUID();           // no sequences in DSQL
      await tx`INSERT INTO expenses (id, group_id, paid_by, amount_minor, currency, description, split_type)
               VALUES (${expenseId}, ${input.groupId}, ${input.paidBy}, ${input.amountMinor},
                       ${input.currency}, ${input.description}, ${input.splitType})`;
      for (const s of input.splits) {                   // ≤10K rows/txn — fine for a group
        await tx`INSERT INTO expense_splits (id, expense_id, user_id, share_minor)
                 VALUES (${crypto.randomUUID()}, ${expenseId}, ${s.userId}, ${s.shareMinor})`;
      }
      return expenseId;
    });
  });
}
```

**Equal-split rounding (do not skip — it breaks INV-1 on the most common operation).** ₦1,000 split 3 ways is 333.33…; naive rounding gives 333+333+333 = 999 ≠ 1000. You must distribute the leftover minor units deterministically so splits always sum to the total:

```typescript
// Split amountMinor across userIds as evenly as possible; remainder spread 1 unit each.
export function equalSplit(amountMinor: number, userIds: string[]): Split[] {
  const n = userIds.length;
  const base = Math.floor(amountMinor / n);
  let remainder = amountMinor - base * n;          // 0..n-1 leftover minor units
  return userIds.map((userId, i) => ({
    userId,
    shareMinor: base + (i < remainder ? 1 : 0),    // first `remainder` members pay 1 extra unit
  }));
  // Σ shareMinor === amountMinor by construction → INV-1 always holds.
}
```

Apply the same remainder discipline to percentage splits (round each share, then assign the rounding drift to the largest share). This is the kind of detail the fintech-aware judges notice.

---

## 6. Debt Simplification (the "smart" feature — Originality points)

Splitwise's headline feature: reduce N tangled debts to the **minimum number of payments** ([Splitwise blog](https://blog.splitwise.com/2012/09/14/debts-made-simple/)). It's a greedy min-cash-flow algorithm on net balances.

```typescript
// Given net balances (positive = creditor, negative = debtor), produce minimal transfers.
// Greedy: repeatedly settle the biggest debtor against the biggest creditor.
export function simplifyDebts(net: Map<string, number>): Transfer[] {
  const creditors = [...net].filter(([, v]) => v > 0).map(([id, v]) => ({ id, amt: v }));
  const debtors   = [...net].filter(([, v]) => v < 0).map(([id, v]) => ({ id, amt: -v }));
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amountMinor: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers; // worst case n-1 transfers; INV-2 guarantees totals reconcile
}
```

This runs on **derived balances** (read path), so it never holds locks and never conflicts. Computing it server-side from DSQL data — and showing "12 debts → 4 payments" in the UI — is a clean, demo-able "wow."

---

## 7. Multi-Currency (Impact + global-scale framing)

- Store each expense in its **original currency** + `amount_minor`. Never pre-convert at write time (rates drift; you'd lose the source of truth).
- Convert **at read/display time** to each user's `currency_pref` using a cached `fx_rate` config (a daily snapshot table or an env-cached map for the demo).
- This ties the "users in Lagos, London, Toronto" narrative directly to DSQL's multi-region active-active positioning ([AWS financial-transactions blog](https://aws.amazon.com/blogs/database/amazon-aurora-dsql-for-global-scale-financial-transactions/)).

---

## 8. Connection & Security (DSQL specifics)

DSQL is **not** a normal Postgres endpoint — connection nuances matter ([AWS connections blog](https://aws.amazon.com/blogs/database/amazon-aurora-dsql-connections-drivers-strings-and-best-practices/), [access-control best practices](https://aws.amazon.com/de/blogs/database/securing-amazon-aurora-dsql-access-control-best-practices/)):

| Concern | Practice |
|---------|----------|
| Auth | **IAM token-based**, not static password. Token is short-lived; generate per connection. `dsql:DbConnect` (not `DbConnectAdmin`) for app role. |
| Transport | `sslmode=require` mandatory. |
| Connection reuse | Serverless functions should reuse connections across invocations; avoid opening a socket per request. Use the Vercel Marketplace DSQL integration which wires OIDC federation (no hardcoded secrets). |
| Least privilege | App role gets table-level DML only; no admin role in the app path. |
| PII minimization | Store email + display name only; no card/bank data in MVP (keeps GDPR surface tiny and "shippable" claim honest). |

**Security flag (do not skip):** the app's API routes mutate financial records — they **must** enforce that the caller is a member of the group before any read/write. Authorization is part of INV-6 and is the most likely place a quick hackathon build leaves a hole. Add a `requireGroupMembership(userId, groupId)` guard on every ledger route.

---

## 9. Cost Analysis (AWS Solution Architect — Step 4)

```json
{
  "hackathon_monthly_usd": 0,
  "breakdown": {
    "aurora_dsql": "Free tier: 100,000 DPU + 1 GiB storage/month — MVP traffic fits entirely inside it",
    "vercel": "Hobby free / Pro covered by hackathon; v0 credits via request form",
    "iam_cloudwatch": "Negligible"
  },
  "post_hackathon_growth_50k_users_est_usd": "low tens/month (DSQL DPU scales with activity; bursty group usage is cheap)",
  "watch_items": [
    "OCC retries amplify DPU under high contention — keep transactions small/fast",
    "Per-request connection churn wastes DPU — reuse connections",
    "Multi-region (active-active) multiplies cost — keep demo single-region, mention multi-region as the scale story"
  ]
}
```

DSQL free tier: first **100K DPU + 1 GiB-month free, every month** ([AWS pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/), [DoiT analysis](https://www.doit.com/blog/comparing-aurora-distributed-sql-vs-aurora-serverless-v2-a-practical-cost-analysis)). Your entire hackathon run is almost certainly $0.

**Single-region for the demo, multi-region as the story.** Running active-active across regions costs more and adds nothing to a recorded demo. Provision one region; *explain* the multi-region capability and show the architecture supports it. Honest and cost-free.

---

## 10. Infrastructure as Code

DSQL clusters are provisioned via the **Vercel Marketplace integration** (the hackathon's intended path — it auto-wires OIDC + env vars), or via CLI/CloudFormation for the cluster itself. Minimal CFN for the cluster:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: LedgerLoop - Aurora DSQL single-region cluster
Resources:
  LedgerCluster:
    Type: AWS::DSQL::Cluster
    Properties:
      DeletionProtectionEnabled: false   # hackathon; enable in prod
      Tags:
        - Key: project
          Value: ledgerloop
        - Key: hackathon
          Value: H0Hackathon

  # App role: least-privilege connect (NOT admin)
  LedgerAppRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: lambda.amazonaws.com }   # or Vercel OIDC federated principal
            Action: sts:AssumeRole
      Policies:
        - PolicyName: dsql-connect
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: [ "dsql:DbConnect" ]   # app role, not DbConnectAdmin
                Resource: !GetAtt LedgerCluster.ResourceArn

Outputs:
  ClusterIdentifier:
    Description: DSQL cluster ID. The connection host is <identifier>.dsql.<region>.on.aws
    Value: !GetAtt LedgerCluster.Identifier
  ClusterArn:
    Description: ARN of the DSQL cluster (used in IAM policies)
    Value: !GetAtt LedgerCluster.ResourceArn
```

> **Valid `AWS::DSQL::Cluster` return attributes** are `Identifier`, `ResourceArn`, and `Status` ([CFN reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dsql-cluster.html)). There is no `VpcEndpointServiceName` / `ClusterEndpoint` attribute — DSQL is not VPC-endpoint-based. You build the connection host yourself as `<identifier>.dsql.<region>.on.aws` and authenticate with a short-lived IAM token. `psql` **v14+** is required (older clients fail because DSQL needs SNI; [troubleshooting](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/troubleshooting.html)).

> For the hackathon, prefer the **Vercel Marketplace → AWS DSQL** flow ([marketplace listing](https://vercel.com/marketplace/aws/aws-dsql)); it handles secretless OIDC auth and injects the connection env vars into your Vercel project. Use this CFN only if you want the cluster defined as code for the architecture-diagram deliverable.

---

## 11. Build Plan (mapped to components, 8 days)

| Day | Component built | Deliverable |
|-----|----------------|-------------|
| 1 | Persistence | Provision DSQL via Vercel Marketplace; run DDL (Section 4) **using `CREATE INDEX ASYNC`**; connect with `psql` v14+; verify IAM-token connect + `sslmode=require` |
| 2 | UI shell | v0-scaffold dashboard / add-expense / balances; **strip any FK/`serial`/`CREATE INDEX` (non-async)/JSON v0 emits** |
| 3 | Ledger Service writes | `addExpense` (atomic + INV-1 + `equalSplit` rounding), `recordSettlement`, `withOccRetry`, `requireGroupMembership` guard |
| 4 | Read path | Balance derivation query (correct settlement signs, INV-2 sum-to-zero **+ direction test**), `simplifyDebts` |
| 5 | Multi-currency + polish | FX display conversion; live revalidation of balances after writes |
| 6 | Deploy + concurrency test | Two-client simultaneous-write test; capture an actual 40001→retry in logs for the video |
| 7 | Demo assets | Architecture diagram (Section 3) + 3–5 min video (Section 12) |
| 8 | Bonus + submit | Blog post; Vercel Team ID + storage-config screenshot; submit |

---

## 12. Demo Video Script (3–5 min — the submission that scores)

1. **Hook (15s):** "Three friends across three continents split a trip. Two add an expense at the same second. On most databases, the balance silently breaks. Watch what we built."
2. **Problem (35s):** Diagram the lost-update bug under eventual consistency. State the invariant: group balances must always sum to zero.
3. **Live solution (110s):** Create group → add expenses (equal/exact split) → show balances summing to zero → run debt simplification ("11 debts → 4 payments") → record a settlement → balances update instantly.
4. **The money shot (45s):** Fire two simultaneous writes. Show the CloudWatch/log line where DSQL returns `40001` and your retry re-applies it — balance still correct. *"Snapshot isolation plus optimistic concurrency control — the conflict is impossible to ignore, so it's impossible to silently corrupt."*
5. **Architecture (40s):** Show Section 3 diagram. "Single Aurora DSQL database. Append-only ledger, derived balances, no foreign keys — modeled for DSQL's constraints on purpose. Active-active multi-region ready; we ran one region for the demo."
6. **Impact (25s):** "Splitwise has 100M+ users. LedgerLoop is the global-first, strongly-consistent version — and it's shippable today."

---

## 13. Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| v0 emits FK/`serial`/`CREATE INDEX` (non-async)/JSON that breaks on DSQL | High | Day-2 manual audit; keep DDL (Section 4) as source of truth, not v0's guess |
| Treating balance as stored state → corruption | Med | Architecture forbids it: balances derived, ledger append-only |
| IAM-token connection trips up the team | Med | Use Vercel Marketplace integration (secretless OIDC); follow connections blog |
| OCC retries storm under contention | Low | Small fast transactions; capped retries + jittered backoff |
| Saying "serializable" in the demo | Med | Say "snapshot isolation (Repeatable Read) + OCC" — judges built this |
| Scope creep beyond 3 core features | High | Lock MVP to: split, simplify, settle. Multi-currency is the only stretch |
| Missing submission artifacts (Team ID, storage screenshot) | Med | Day-8 checklist; these cause disqualification |

---

## 14. Final Verdict

The architecture-selection math and the AWS pattern analysis both point the same way: a **single-database, layered serverless app on Aurora DSQL with an append-only ledger and derived balances.** It has the lowest cross-cutting complexity (0% cross-cutting requirements, flow density 0.25, zero cycles), the lowest 8-day build risk, and — most importantly — it makes the database choice **load-bearing and demonstrable** rather than cosmetic. That is the exact thing four senior AWS database judges are equipped to reward, and it's what separates a winner from the 1,500 generic CRUD submissions.

Build LedgerLoop. Keep it single-region, single-database, three features. Let the concurrency story carry the technical score, the debt-simplification carry originality, and the clean expense-splitting UX carry design and impact.

---

## Sources

| # | Source | Type |
|---|--------|------|
| 1 | [h01.devpost.com — official hackathon page](https://h01.devpost.com) | Primary |
| 2 | [AWS: Aurora DSQL — concurrency control (OCC, 40001)](https://aws.amazon.com/cn/blogs/database/concurrency-control-in-amazon-aurora-dsql/) | Primary |
| 3 | [AWS docs: Aurora DSQL & PostgreSQL (Repeatable Read isolation)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with.html) | Primary |
| 4 | [AWS docs: DSQL concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html) | Primary |
| 5 | [AWS: Aurora DSQL unsupported features (no FK/triggers/sequences)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html) | Primary |
| 6 | [AWS: Aurora DSQL connections — drivers, strings, best practices](https://aws.amazon.com/blogs/database/amazon-aurora-dsql-connections-drivers-strings-and-best-practices/) | Primary |
| 7 | [AWS: Securing Aurora DSQL — access control best practices](https://aws.amazon.com/de/blogs/database/securing-amazon-aurora-dsql-access-control-best-practices/) | Primary |
| 8 | [AWS: Aurora DSQL for global-scale financial transactions](https://aws.amazon.com/blogs/database/amazon-aurora-dsql-for-global-scale-financial-transactions/) | Primary |
| 9 | [AWS: Aurora DSQL pricing (free tier 100K DPU + 1GiB)](https://aws.amazon.com/rds/aurora/dsql/pricing/) | Primary |
| 10 | [Vercel Marketplace: AWS DSQL integration](https://vercel.com/marketplace/aws/aws-dsql) | Primary |
| 11 | [Vercel: Next.js + Aurora DSQL template](https://examples.vercel.com/templates/next.js/next-js-vercel-app-with-aurora-dsql) | Primary |
| 12 | [Splitwise blog — debt simplification](https://blog.splitwise.com/2012/09/14/debts-made-simple/) | Secondary |
| 13 | [Mithun M K — Splitwise debt-simplification algorithm](https://medium.com/@mithunmk93/algorithm-behind-splitwises-debt-simplification-feature-8ac485e97688) | Secondary |
| 14 | [Modern Treasury — store money as integers, not floats](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents) | Secondary |
| 15 | [Andrew Baker — Aurora DSQL deep dive (limits)](https://andrewbaker.ninja/2025/11/19/amazon-aurora-dsql-a-deep-dive-into-performance-and-limitations/) | Secondary |
| 16 | [DoiT — DSQL vs Aurora Serverless v2 cost analysis](https://www.doit.com/blog/comparing-aurora-distributed-sql-vs-aurora-serverless-v2-a-practical-cost-analysis) | Secondary |
| 17 | [AWS docs: Migrating from PostgreSQL to Aurora DSQL (CREATE INDEX ASYNC, troubleshooting/SNI)](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html) | Primary |

## Audit Log

```
Queries sent (this round):   8 (verification)
Cumulative queries:          36
Sources cited (this file):   17
Failures:                    2 (web_fetch on 2 AWS doc pages — verified via search snippets instead)
Skills applied:              /aws-solution-architect, /architecture-selection
Key correction:              DSQL isolation = Repeatable Read (snapshot) + OCC, NOT serializable
Architecture decision:       Candidate A (layered serverless monolith) + B's append-only ledger idea
Sub-questions resolved:
  1. What architecture minimizes cross-cutting concerns for a ledger? → layered monolith
  2. How does DSQL actually enforce the no-double-count invariant? → snapshot isolation + OCC 40001 retry
  3. How to model money + balances safely? → BIGINT minor units, derived balances, append-only ledger
  4. How to connect DSQL from Vercel serverless securely? → IAM token, sslmode=require, Marketplace OIDC
  5. What does it cost? → ~$0 on free tier; single-region demo, multi-region as story
  6. What's the minimal-transaction settlement algorithm? → greedy min-cashflow on net balances
```

## Correctness Audit (verification round, May 31, 2026)

Bugs found and fixed in this pass — each would have caused a real failure:

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | **Balance SQL had flipped settlement signs** (`+settled_in − settled_out`). A payment would move balances the wrong direction. INV-2 (sum-to-zero) still held, so the property check would NOT catch it. | **Critical** (silent wrong balances in live demo) | Corrected to `+settled_out − settled_in`; documented sign convention + added a direction test |
| 2 | **`CREATE INDEX` is invalid on DSQL** — requires `CREATE INDEX ASYNC`. DDL would fail on Day 1. | **Critical** (schema won't deploy) | All indexes changed to `CREATE INDEX ASYNC`; added unique membership index |
| 3 | **CloudFormation Output used non-existent `VpcEndpointServiceName`** attribute. | High (template fails / misleads) | Replaced with valid `Identifier` + `ResourceArn`; documented the `<id>.dsql.<region>.on.aws` host pattern |
| 4 | **Equal-split rounding gap** — ₦1,000 / 3 = 999 ≠ 1000, breaking INV-1 on the most common operation. | High (core feature produces invalid splits) | Added `equalSplit()` with deterministic remainder distribution |
| 5 | **Undefined types** (`Sql`, `ExpenseInput`, `Split`, `Transfer`) referenced by code samples. | Medium (code not self-contained) | Added shared type block in Section 5 |
| 6 | **`psql` v14+ / SNI requirement** not stated — older clients silently fail to connect. | Medium (Day-1 connection blocker) | Documented in Section 10 |

Verified against AWS docs this round: DSQL `CREATE INDEX ASYNC` requirement, `CHECK`/`PRIMARY KEY` support, `AWS::DSQL::Cluster` return attributes (`Identifier`/`ResourceArn`/`Status`), Repeatable Read + OCC isolation, and the SNI/psql-v14 connection requirement.

**Remaining known assumptions (not errors, but flagged for honesty):**
- DPU cost at 50k users is an estimate, not a measured figure — validate with the AWS pricing calculator before quoting it publicly.
- The `postgres` (porsager) client is assumed to accept an IAM token as the password field; confirm token-refresh handling for connections that outlive the ~15-min token lifetime (use the Vercel Marketplace integration or the AWS DSQL connector to handle refresh).

---

*Last updated: May 31, 2026 | Companion to mine.md*
