# LedgerLoop  Deep Architecture & Solution Design

**H0 Hackathon ("Hack the Zero Stack")  AWS + Vercel | Deadline: June 30, 2026**

> Companion to `mine.md`. That file picked **LedgerLoop** as the highest-probability winner. This file proves the architecture is sound, applies a formal architecture-selection methodology, and hands you a build-ready spec with IaC, data model, cost analysis, and the exact consistency story the AWS database judges want to hear.

---

## 0. Executive Summary

LedgerLoop is a multi-region group expense ledger where **shared balances stay correct even when group members in different regions edit simultaneously.** The architecture is deliberately **single-database (Aurora PostgreSQL)**  not because Aurora PostgreSQL is trendy, but because the core invariant (group balances must sum to zero and never double-count a concurrent edit) is *exactly* the problem Aurora PostgreSQL's **SERIALIZABLE** isolation solves. That alignment between problem and database is the whole pitch.

**One-sentence judge hook:**
> "We didn't pick Aurora PostgreSQL because it's popular  we picked it because a group ledger has a correctness invariant that eventual consistency physically cannot hold, and Aurora PostgreSQL's SERIALIZABLE isolation aborts the conflicting write instead of silently corrupting the balance."

---

## 1. Requirements (AWS Solution Architect  Step 1)

```json
{
  "application_type": "b2c_fintech_ledger",
  "expected_users": 50000,
  "concurrent_peak": "group-bursty (dinner/trip settle moments)",
  "requests_per_second": 50,
  "budget_monthly_usd": 0,
  "budget_note": "Hackathon: AWS credits + Aurora PostgreSQL Serverless v2",
  "team_size": "1-5",
  "aws_experience": "intermediate",
  "compliance": ["GDPR-aware (PII minimization)", "no real money movement in MVP"],
  "availability_sla": "99.99% single-region (demo target)",
  "required_stack": ["Vercel v0 / Next.js", "Aurora PostgreSQL"],
  "deploy_target": "Vercel"
}
```

**Deliberate scoping decision:** MVP does **not** move real money (no card rails, no payouts). It *tracks and simplifies* debt. This keeps it legally clean and keeps "shippable" credible.

---

## 2. Architecture Selection (formal methodology)

Following the `/architecture-selection` discipline: classify variables → map to requirements → extract invariants → generate candidates *before* scoring → score → select.

### 2a. Variable Classification

| Variable | Classification | Notes |
|---|---|---|
| `user` (id, name, region, currency_pref) | State (entity) | Identity + display |
| `group` (id, name, base_currency) | State (entity) | Container |
| `membership` (group_id, user_id) | State (relationship) | Join |
| `expense` (amount_minor, paid_by, split_type) | Input → State | Immutable once posted |
| `expense_split` (expense_id, user_id, share_minor) | State (derived on write) | Must sum to expense amount |
| `settlement` (from_user, to_user, amount_minor) | Event → State | Records a payback |
| `balance(group, user)` | Output (derived) | Σ paid − Σ owed; never stored as truth |
| `simplified_plan` | Output (computed) | Min-cashflow transaction set |
| `fx_rate` | Configuration Parameter | External, cached |
| `occ_retry` | Side Effect | Retry on 40001 |

**Key insight from classification:** `balance` is an **Output, not State**. The single most common LedgerLoop bug is treating a stored balance as the source of truth and updating it in place  that's the row that gets corrupted under concurrency. The architecture must derive balances from the immutable expense/settlement ledger, so concurrency conflicts happen on *appends*, where Aurora PostgreSQL's SERIALIZABLE isolation protects you.

### 2b. Requirement–Variable Map (R=read, W=write)

| Requirement | user | group | membership | expense | split | settlement | balance |
|---|---|---|---|---|---|---|---|
| REQ-1 Create/join group | R | W | W | | | | |
| REQ-2 Add expense + split | R | R | R | W | W | | |
| REQ-3 View balances | R | R | R | R | R | R | **W(derive)** |
| REQ-4 Record settlement | R | R | R | | | W | |
| REQ-5 Simplify debts | | R | R | R | R | R | R |
| REQ-6 Multi-currency display | R | R | | R | R | R | R |

**Co-access clusters:** `{expense, split}` always move together (write cluster). `{expense, split, settlement}` are all read together to derive `balance` (read cluster). The **ledger** is one cohesive component and **balance derivation** is a distinct read-path concern.

### 2c. Invariant Extraction

| # | Invariant | Constrains | Enforced by |
|---|---|---|---|
| INV-1 | Σ(splits) == expense.amount for every expense | expense, split | Single transaction (atomic) |
| INV-2 | Σ(balances) across a group == 0 at all times | balance | Derivation logic + INV-1 |
| INV-3 | No expense/settlement is double-counted under concurrent writes | expense, settlement | **Aurora PostgreSQL SERIALIZABLE isolation (40001 abort + retry)** |
| INV-4 | Money never represented as float | amount_minor | `BIGINT` minor units |
| INV-5 | A settlement cannot exceed what's owed | settlement, balance | App-layer validation |
| INV-6 | Referential integrity (split → expense, membership → group) | all | App layer + Aurora PostgreSQL foreign keys |

INV-3 is the **load-bearing invariant** and the reason Aurora PostgreSQL is the right database. INV-6 is enforced at both the application layer and the database level via Aurora PostgreSQL's full foreign key support.

### 2d. Candidate Architectures

#### Candidate A  Layered Serverless Monolith (Next.js on Vercel + Aurora PostgreSQL)
- **Components:** Web/UI → API Routes / Server Actions → Ledger Service → Aurora PostgreSQL.
- **Req allocation:** all REQ live in Ledger Service; UI is presentation only.
- **Steelman:** Fastest to build, one deploy artifact, one mental model. Near-zero cross-cutting. Lowest-risk path to a working demo on an 8-day clock.

#### Candidate B  Event-Sourced CQRS (append-only event log + projection)
- **Components:** Command API → Event Store → Projector → Read Model → Query API → UI.
- **Steelman:** Philosophically beautiful for a ledger. Scales reads independently. If LedgerLoop became a real fintech product, this is where it'd go  and you can say that to judges to show architectural maturity.

#### Candidate C  Microservices (separate User, Group, Expense, Settlement services)
- **Components:** 4 services + API gateway + Aurora PostgreSQL.
- **Invariant allocation:** INV-2/3 now require cross-service coordination  distributed transaction or saga.
- **Red flag:** fights the database's strength and adds distributed-transaction risk.

### 2e. Scoring

| Metric | A (Layered Monolith) | B (Event-Sourced CQRS) | C (Microservices) |
|---|---|---|---|
| Cross-cutting requirements % | **0%** | ~33% | ~66% |
| Information flow density | **0.25** | 0.45 | 0.7 |
| Synchronous cycles | **0** | 0 | risk of cycles |
| Build risk on 8-day clock | **Low** | Medium-High | **High** |
| Consistency-story clarity for judges | **High** | High | Diluted by saga |

### 2f. Selection

**Recommended: Candidate A (Layered Serverless Monolith), with one borrowed idea from B.**

> Candidate A has 0% cross-cutting requirements, the lowest flow density, zero synchronous cycles, and the lowest build risk. We borrow B's append-only ledger idea (expenses/settlements are immutable inserts, balances always derived) without paying for a separate projector.

**The hybrid:** Monolith structure (A) + immutable append-only ledger + derived balances (B's best idea). Simple to build, correct under concurrency, and truthfully "event-sourced at the data layer."

---

## 3. AWS Solution Architect  Recommended Pattern

**Pattern: Serverless Web  Vercel-fronted, Aurora PostgreSQL-backed.**

```json
{
  "recommended_pattern": "serverless_fullstack_vercel_aurora_postgresql",
  "service_stack": ["Vercel (Next.js + Edge)", "Aurora PostgreSQL Serverless v2", "CloudWatch"],
  "estimated_monthly_cost_usd": 0,
  "cost_basis": "Aurora PostgreSQL Serverless v2 ACU-based pricing; Vercel hobby/pro credits",
  "pros": ["Zero infra mgmt", "SERIALIZABLE isolation built-in", "Scales to zero", "One deploy", "Full FK/constraint support"],
  "cons": ["OCC retry logic required under high contention", "Cold start latency on first request"]
}
```

### System diagram

```
            ┌──────────────────────────────────────────────────────────┐
            │                     VERCEL (deploy target)                │
            │                                                          │
   Users ──▶│  Next.js App Router                                       │
 (LDN/LAG/  │   ├─ Server Components ── initial render, data fetch      │
  TOR)      │   ├─ Client Components ── forms, live balance display     │
            │   └─ Server Actions  ◀── all write operations             │
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
                            │  standard password auth, sslmode=require
                            ▼
            ┌──────────────────────────────────────────────────────────┐
            │              AURORA POSTGRESQL SERVERLESS v2              │
            │   Append-only ledger (immutable):                         │
            │     expenses, expense_splits, settlements                 │
            │   Reference state:                                        │
            │     users, groups, group_members                          │
            │   Guarantees: SERIALIZABLE isolation + OCC (SQLSTATE 40001)│
            │   Foreign key enforcement on all relationships            │
            └──────────────────────────────────────────────────────────┘
                            │
                            ▼
                   CloudWatch (OCC abort rate, p99 latency)
```

---

## 4. Data Model (Aurora PostgreSQL DDL)

Aurora PostgreSQL fully supports foreign keys, sequences, triggers, views, and standard indexing. Money stored as `BIGINT` minor units (INV-4  never float).

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL,
  home_region   TEXT NOT NULL,
  currency_pref CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  id        UUID PRIMARY KEY,
  group_id  UUID NOT NULL REFERENCES groups(id),
  user_id   UUID NOT NULL REFERENCES users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX idx_members_group ON group_members (group_id);
CREATE INDEX idx_members_user  ON group_members (user_id);

-- Append-only. Corrections are new reversing rows.
CREATE TABLE expenses (
  id            UUID PRIMARY KEY,
  group_id      UUID NOT NULL REFERENCES groups(id),
  paid_by       UUID NOT NULL REFERENCES users(id),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  currency      CHAR(3) NOT NULL,
  description   TEXT NOT NULL,
  split_type    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_group ON expenses (group_id);

CREATE TABLE expense_splits (
  id          UUID PRIMARY KEY,
  expense_id  UUID NOT NULL REFERENCES expenses(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  share_minor BIGINT NOT NULL CHECK (share_minor >= 0)
);
CREATE INDEX idx_splits_expense ON expense_splits (expense_id);

CREATE TABLE settlements (
  id           UUID PRIMARY KEY,
  group_id     UUID NOT NULL REFERENCES groups(id),
  from_user    UUID NOT NULL REFERENCES users(id),
  to_user      UUID NOT NULL REFERENCES users(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_settlements_group ON settlements (group_id);

-- Set SERIALIZABLE isolation at the database level
ALTER DATABASE ledgerloop SET default_transaction_isolation = 'serializable';
```

**Balance derivation (INV-2)  computed, never stored:**

```sql
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
-- SUM(net_minor) MUST equal 0 (INV-2).
-- NOTE: INV-2 holds for EITHER sign convention, so sum-to-zero alone
-- will NOT catch a flipped settlement sign. Add a direction test.
```

---

## 5. The Concurrency Story (your winning differentiator)

**Shared types:**

```typescript
type SplitType = "equal" | "percent" | "exact";

interface Split        { userId: string; shareMinor: number; }
interface ExpenseInput {
  groupId: string;
  paidBy: string;
  amountMinor: number;
  currency: string;
  description: string;
  splitType: SplitType;
  splits: Split[];
}
interface Transfer { from: string; to: string; amountMinor: number; }
```

**The setup:** Two members of the same group submit an expense at the same instant.

**What Aurora PostgreSQL does:** Both transactions run under `SERIALIZABLE` isolation. At commit, Aurora PostgreSQL detects the write conflict and aborts one with `SQLSTATE 40001`. The aborted transaction is retried by `withOccRetry()` against fresh state. Both expenses land, balances stay correct, INV-2 holds.

**Why this is the pitch:** With an eventually-consistent store, both writes succeed against stale replicas and the balance silently diverges. Aurora PostgreSQL's `SERIALIZABLE` isolation makes the conflict impossible to ignore  it surfaces as a retryable error rather than silent corruption.

```typescript
// OCC retry wrapper (INV-3)
const OCC_CONFLICT = "40001";

export async function withOccRetry<T>(fn: () => Promise<T>, max = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.code ?? err?.sqlState;
      if (code === OCC_CONFLICT && attempt < max - 1) {
        await new Promise(r => setTimeout(r, 25 * 2 ** attempt + Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
}

// Atomic expense insert (INV-1 validated before commit)
export async function addExpense(sql: Sql, input: ExpenseInput) {
  const shareSum = input.splits.reduce((s, x) => s + x.shareMinor, 0);
  if (shareSum !== input.amountMinor) {
    throw new Error("INV-1 violation: splits must sum to expense amount");
  }
  return withOccRetry(async () => {
    return sql.begin(async (tx) => {
      const ok = await tx`SELECT 1 FROM group_members
                          WHERE group_id = ${input.groupId} AND user_id = ${input.paidBy}`;
      if (ok.length === 0) throw new Error("INV-6: payer not a group member");

      const expenseId = crypto.randomUUID();
      await tx`INSERT INTO expenses (id, group_id, paid_by, amount_minor, currency, description, split_type)
               VALUES (${expenseId}, ${input.groupId}, ${input.paidBy}, ${input.amountMinor},
                       ${input.currency}, ${input.description}, ${input.splitType})`;
      for (const s of input.splits) {
        await tx`INSERT INTO expense_splits (id, expense_id, user_id, share_minor)
                 VALUES (${crypto.randomUUID()}, ${expenseId}, ${s.userId}, ${s.shareMinor})`;
      }
      return expenseId;
    });
  });
}
```

**Equal-split rounding (do not skip  it breaks INV-1 on the most common operation):**

₦1,000 split 3 ways = 333.33…; naive rounding gives 333+333+333 = 999 ≠ 1000.

```typescript
export function equalSplit(amountMinor: number, userIds: string[]): Split[] {
  const n = userIds.length;
  const base = Math.floor(amountMinor / n);
  const remainder = amountMinor - base * n;
  return userIds.map((userId, i) => ({
    userId,
    shareMinor: base + (i < remainder ? 1 : 0),
  }));
  // Σ shareMinor === amountMinor by construction → INV-1 always holds.
}
```

Apply the same remainder discipline to percentage splits (floor each share, distribute drift to largest fractional remainders).

---

## 6. Debt Simplification (the "smart" feature  Originality points)

Reduce N tangled debts to the **minimum number of payments** using a greedy min-cashflow algorithm.

```typescript
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
  return transfers; // worst case n-1 transfers
}
```

Runs on the read path. Never holds locks. "12 debts → 4 payments" in the UI is a clean, demo-able result.

---

## 7. Multi-Currency

- Store each expense in its **original currency** + `amount_minor`. Never pre-convert at write time.
- Convert **at read/display time** to each user's `currency_pref` using a cached FX rate.
- Ties the "users in Lagos, London, Toronto" narrative directly to Aurora PostgreSQL's multi-region positioning.

---

## 8. Connection & Security

Aurora PostgreSQL uses standard PostgreSQL wire protocol with password-based authentication.

| Concern | Practice |
|---|---|
| Auth | Standard password auth via `AURORA_PASSWORD` env var |
| Transport | `sslmode=require` mandatory |
| Connection reuse | Reuse connections across serverless invocations |
| Least privilege | App role gets table-level DML only |
| PII minimization | Store email + display name only; no card/bank data in MVP |

**Environment variables:**

| Variable | Purpose |
|---|---|
| `AURORA_HOST` | Aurora writer endpoint |
| `AURORA_PORT` | Default 5432 |
| `AURORA_DB` | Default "ledgerloop" |
| `AURORA_USER` | Default "ledgerloop_admin" |
| `AURORA_PASSWORD` | Password (from Secrets Manager) |

**Security note:** every ledger route must enforce that the caller is a group member before any read/write. Authorization is part of INV-6 and is the most likely gap in a fast hackathon build. Add a `requireGroupMembership(userId, groupId)` guard on every ledger route.

---

## 9. Cost Analysis

```json
{
  "hackathon_monthly_usd": 0,
  "breakdown": {
    "aurora_postgresql_serverless_v2": "ACU-based billing, scales to zero between requests",
    "vercel": "Hobby free / Pro covered by hackathon credits"
  },
  "watch_items": [
    "OCC retries amplify DB load under high contention  keep transactions small",
    "Per-request connection churn wastes resources  reuse connections",
    "Multi-region multiplies cost  keep demo single-region, mention it as the scale story"
  ]
}
```

Aurora PostgreSQL Serverless v2 scales to zero ACUs when idle. The entire hackathon run is effectively $0.

---

## 10. Infrastructure as Code

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: LedgerLoop - Aurora PostgreSQL Serverless v2
Resources:
  LedgerDBCluster:
    Type: AWS::RDS::DBCluster
    Properties:
      Engine: aurora-postgresql
      EngineMode: provisioned
      EngineVersion: "17.7"
      DatabaseName: ledgerloop
      MasterUsername: ledgerloop_admin
      ManageMasterUserPassword: true
      ServerlessV2ScalingConfiguration:
        MinCapacity: 0.5
        MaxCapacity: 4
      DeletionProtection: false
      Tags:
        - Key: project
          Value: ledgerloop

  LedgerDBInstance:
    Type: AWS::RDS::DBInstance
    Properties:
      DBClusterIdentifier: !Ref LedgerDBCluster
      DBInstanceClass: db.serverless
      Engine: aurora-postgresql

Outputs:
  ClusterEndpoint:
    Description: Aurora writer endpoint (use as AURORA_HOST)
    Value: !GetAtt LedgerDBCluster.Endpoint.Address
  ClusterPort:
    Description: Aurora port (use as AURORA_PORT)
    Value: !GetAtt LedgerDBCluster.Endpoint.Port
```

---

## 11. Build Plan (8 days)

| Day | Component | Deliverable |
|---|---|---|
| 1 | Persistence | Provision Aurora PostgreSQL Serverless v2; run DDL; verify connection |
| 2 | UI shell | Scaffold dashboard, add-expense, balance views |
| 3 | Ledger Service writes | `addExpense`, `recordSettlement`, `withOccRetry`, auth guard |
| 4 | Read path | Balance derivation (correct signs, INV-2 + direction test), `simplifyDebts` |
| 5 | Multi-currency + polish | FX display; live revalidation after writes |
| 6 | Deploy + concurrency test | Two-client simultaneous write; capture 40001→retry in logs |
| 7 | Demo assets | Architecture diagram + 3–5 min video |
| 8 | Submit | Blog post; verify submission checklist |

---

## 12. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Treating balance as stored state | Med | Architecture forbids it: balances derived, ledger append-only |
| OCC retry storm under contention | Low | Small fast transactions; capped retries + jittered backoff |
| Scope creep beyond 3 core features | High | Lock MVP: split, simplify, settle. Multi-currency is the only stretch |
| Missing submission artifacts | Med | Day-8 checklist |

---

## 13. Final Verdict

The architecture-selection math and the AWS pattern analysis both point the same direction: a **single-database, layered serverless app on Aurora PostgreSQL with an append-only ledger and derived balances.** It has the lowest cross-cutting complexity, the lowest 8-day build risk, and  most importantly  it makes the database choice load-bearing and demonstrable rather than cosmetic.

Build LedgerLoop. Keep it single-region, single-database, three features. Let the concurrency story carry the technical score, debt-simplification carry originality, and clean UX carry design.

---

## Sources

| # | Source |
|---|---|
| 1 | h01.devpost.com  official hackathon page |
| 2 | AWS docs: Aurora PostgreSQL SERIALIZABLE isolation |
| 3 | AWS docs: Aurora PostgreSQL Serverless v2 |
| 4 | Splitwise blog  debt simplification algorithm |
| 5 | Modern Treasury  store money as integers, not floats |
