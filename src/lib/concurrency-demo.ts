/**
 * Concurrency demo harness — a faithful, in-process reproduction of the
 * write-write conflict that Aurora DSQL resolves with snapshot isolation + OCC.
 *
 * This is the centrepiece of the LedgerLoop pitch: a group ledger has a
 * correctness invariant (every expense must be durably recorded; balances must
 * stay zero-sum) that eventual consistency cannot hold. DSQL aborts the loser
 * of two overlapping transactions with SQLSTATE 40001 instead of silently
 * losing its update; our {@link withOccRetry} wrapper backs off and retries
 * against fresh state so BOTH writes land.
 *
 * Everything below is real production code, not a mock:
 *   - the actual {@link withOccRetry} retry/backoff wrapper
 *   - the actual {@link OccConflictError} (SQLSTATE 40001) detection path
 *   - the actual {@link InMemoryPersistence} append + {@link deriveNetPositions}
 *     read-path derivation
 *
 * The ONLY thing simulated is the timing race itself: a small version-stamped
 * wrapper reproduces snapshot isolation (each transaction reads a version, and
 * a commit whose version moved underneath it is aborted with 40001). Two
 * writers are launched overlapping so the second deterministically loses its
 * first commit attempt — exactly the scenario DSQL handles in production.
 */

import { InMemoryPersistence, OccConflictError } from "@/ledger/in-memory-persistence";
import { withOccRetry, OccExhaustedError } from "@/ledger/occ-retry";
import { deriveNetPositions } from "@/domain/balance-engine";
import type { ExpenseRow, SplitRow } from "@/ledger/persistence";

const GROUP_ID = "demo-group";
const BASE_CURRENCY = "USD";

/** The two contending members. Ada's writer starts first and wins the race. */
const ADA = { id: "ada", name: "Ada" };
const GRACE = { id: "grace", name: "Grace" };

/** Ada pays $60.00, split equally → 3000 minor each. */
const EXPENSE_ADA = {
  amountMinor: 6000,
  description: "Dinner — Ada paid",
} as const;

/** Grace pays $40.00, split equally → 2000 minor each. */
const EXPENSE_GRACE = {
  amountMinor: 4000,
  description: "Taxi — Grace paid",
} as const;

const EXPECTED_TOTAL_MINOR = EXPENSE_ADA.amountMinor + EXPENSE_GRACE.amountMinor;

/** Overlap timing (ms). `WINDOW > START_GAP` guarantees the writers overlap. */
const TXN_WINDOW_MS = 30;
const START_GAP_MS = 8;

export type DemoEventKind =
  | "read"
  | "attempt"
  | "conflict"
  | "backoff"
  | "commit"
  | "exhausted";

export interface DemoEvent {
  tMs: number;
  writer: string;
  kind: DemoEventKind;
  detail: string;
}

export interface WriterReport {
  name: string;
  attempts: number;
  committed: boolean;
  exhausted: boolean;
}

export interface ScenarioReport {
  id: "naive" | "occ";
  label: string;
  description: string;
  maxAttempts: number;
  writers: WriterReport[];
  events: DemoEvent[];
  recordedTotalMinor: number;
  expectedTotalMinor: number;
  lostWrites: number;
  netPositions: { name: string; netMinor: number }[];
  zeroSum: boolean;
  durationMs: number;
  baseCurrency: string;
}

export interface DemoReport {
  naive: ScenarioReport;
  occ: ScenarioReport;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A version-stamped wrapper around {@link InMemoryPersistence} that reproduces
 * snapshot isolation + OCC: a transaction snapshots the version on read, and
 * its commit is aborted with a real {@link OccConflictError} (SQLSTATE 40001)
 * if another transaction committed in the meantime.
 */
class OccSimLedger {
  private version = 0;
  constructor(
    private readonly inner: InMemoryPersistence,
    private readonly log: (e: Omit<DemoEvent, "tMs">) => void,
  ) {}

  async commitExpense(
    writer: string,
    expense: ExpenseRow,
    splits: SplitRow[],
  ): Promise<void> {
    // Snapshot read: capture the version this transaction sees.
    const readVersion = this.version;
    this.log({ writer, kind: "read", detail: `snapshot @ v${readVersion}` });

    // The transaction window during which another writer may interleave.
    await sleep(TXN_WINDOW_MS);

    // OCC check at commit time: if the ledger moved, abort the loser with 40001.
    if (this.version !== readVersion) {
      throw new OccConflictError();
    }

    this.version += 1;
    await this.inner.insertExpenseWithSplits(expense, splits);
  }
}

function buildRows(
  writer: { id: string },
  expense: { amountMinor: number; description: string },
): { expense: ExpenseRow; splits: SplitRow[] } {
  const id = `exp-${writer.id}`;
  const half = expense.amountMinor / 2;
  const now = new Date().toISOString();
  return {
    expense: {
      id,
      groupId: GROUP_ID,
      paidBy: writer.id,
      amountMinor: expense.amountMinor,
      currency: BASE_CURRENCY,
      description: expense.description,
      splitType: "equal",
      createdAt: now,
    },
    splits: [
      { id: `${id}-ada`, expenseId: id, userId: ADA.id, shareMinor: half },
      { id: `${id}-grace`, expenseId: id, userId: GRACE.id, shareMinor: half },
    ],
  };
}

async function runScenario(
  id: "naive" | "occ",
  maxAttempts: number,
  label: string,
  description: string,
): Promise<ScenarioReport> {
  const persistence = new InMemoryPersistence();
  // Seed memberships so loadLedger lists both members.
  await persistence.insertMembership({
    id: "m-ada",
    groupId: GROUP_ID,
    userId: ADA.id,
    joinedAt: new Date().toISOString(),
  });
  await persistence.insertMembership({
    id: "m-grace",
    groupId: GROUP_ID,
    userId: GRACE.id,
    joinedAt: new Date().toISOString(),
  });

  const events: DemoEvent[] = [];
  const start = Date.now();
  const log = (e: Omit<DemoEvent, "tMs">) =>
    events.push({ ...e, tMs: Date.now() - start });

  const ledger = new OccSimLedger(persistence, log);

  const makeWriter = (
    member: { id: string; name: string },
    expense: { amountMinor: number; description: string },
  ) => {
    const report: WriterReport = {
      name: member.name,
      attempts: 0,
      committed: false,
      exhausted: false,
    };
    const { expense: expenseRow, splits } = buildRows(member, expense);

    const run = async () => {
      try {
        await withOccRetry(
          async () => {
            report.attempts += 1;
            const attempt = report.attempts;
            log({
              writer: member.name,
              kind: "attempt",
              detail: `transaction attempt #${attempt}`,
            });
            try {
              await ledger.commitExpense(member.name, expenseRow, splits);
            } catch (e) {
              if (e instanceof OccConflictError) {
                log({
                  writer: member.name,
                  kind: "conflict",
                  detail: "aborted by DSQL — SQLSTATE 40001 (write-write conflict)",
                });
              }
              throw e;
            }
            report.committed = true;
            log({
              writer: member.name,
              kind: "commit",
              detail: `committed ${expense.description}`,
            });
          },
          {
            max: maxAttempts,
            delay: async (ms) => {
              log({
                writer: member.name,
                kind: "backoff",
                detail: `retry after ${Math.round(ms)}ms jittered backoff`,
              });
              await sleep(ms);
            },
          },
        );
      } catch (e) {
        if (e instanceof OccExhaustedError) {
          report.exhausted = true;
          log({
            writer: member.name,
            kind: "exhausted",
            detail: "retries exhausted — write DROPPED, ledger update lost",
          });
        } else {
          throw e;
        }
      }
    };

    return { run, report };
  };

  const ada = makeWriter(ADA, EXPENSE_ADA);
  const grace = makeWriter(GRACE, EXPENSE_GRACE);

  // Launch overlapping: Ada starts first and wins; Grace reads the same
  // snapshot, then loses her first commit to Ada's — exactly the DSQL race.
  const adaPromise = ada.run();
  await sleep(START_GAP_MS);
  const gracePromise = grace.run();
  await Promise.all([adaPromise, gracePromise]);

  const durationMs = Date.now() - start;

  // Read path: derive balances from the durable ledger (never stored).
  const snapshot = await persistence.loadLedger(GROUP_ID);
  const recordedTotalMinor = snapshot.expenses.reduce(
    (sum, e) => sum + e.amountMinor,
    0,
  );
  const net = deriveNetPositions(snapshot);
  const netPositions = [ADA, GRACE].map((m) => ({
    name: m.name,
    netMinor: net.get(m.id) ?? 0,
  }));
  const zeroSum = netPositions.reduce((s, p) => s + p.netMinor, 0) === 0;
  const lostWrites = [ada.report, grace.report].filter(
    (w) => !w.committed,
  ).length;

  return {
    id,
    label,
    description,
    maxAttempts,
    writers: [ada.report, grace.report],
    events,
    recordedTotalMinor,
    expectedTotalMinor: EXPECTED_TOTAL_MINOR,
    lostWrites,
    netPositions,
    zeroSum,
    durationMs,
    baseCurrency: BASE_CURRENCY,
  };
}

/**
 * Run both scenarios against the same contention and return a side-by-side
 * report:
 *   - "naive": no retry (max = 1). The loser's 40001 is fatal — its write is
 *     silently dropped, so the ledger is missing an expense.
 *   - "occ": LedgerLoop's bounded OCC retry (max = 4). The loser backs off and
 *     retries against fresh state; both writes land and balances stay zero-sum.
 */
export async function runConcurrencyDemo(): Promise<DemoReport> {
  const naive = await runScenario(
    "naive",
    1,
    "Naive write (no retry)",
    "A single transaction attempt. When DSQL aborts the loser with SQLSTATE 40001, there is no recovery — the write is dropped and the ledger silently loses an expense.",
  );
  const occ = await runScenario(
    "occ",
    4,
    "LedgerLoop (bounded OCC retry)",
    "The same race, wrapped in withOccRetry. The aborted transaction backs off with jittered exponential delay and retries against fresh state, so both writes commit durably.",
  );
  return { naive, occ };
}
