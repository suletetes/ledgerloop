import Link from "next/link";
import { runConcurrencyDemo, type DemoReport } from "../../../lib/concurrency-demo";
import { ConcurrencyDemoRunner } from "./demo-runner";

/**
 * Public concurrency demo (no auth) — the live proof behind LedgerLoop's
 * "why Aurora PostgreSQL" thesis. Judges can run two overlapping ledger writes and watch
 * Aurora abort the loser with SQLSTATE 40001, then watch our OCC retry recover
 * it so both writes land and balances stay zero-sum.
 */

export const metadata = {
  title: "Concurrency proof · LedgerLoop",
  description:
    "Watch two simultaneous ledger writes conflict under snapshot isolation, get aborted with SQLSTATE 40001, and recover via bounded OCC retry — no lost updates, balances stay zero-sum.",
};

async function runDemoAction(): Promise<DemoReport> {
  "use server";
  return runConcurrencyDemo();
}

export default function ConcurrencyDemoPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/"
        className="text-sm text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
      >
        ← Back home
      </Link>

      <header className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
          Why Aurora PostgreSQL
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-balance text-neutral-900">
          Two people, one ledger, the same instant
        </h1>
        <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-neutral-600">
          A shared ledger has a correctness invariant that eventual consistency
          cannot hold: every expense must be durably recorded and balances must
          stay zero-sum. When two members write at once, Aurora&apos;s snapshot
          isolation aborts the loser with{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-sm text-neutral-800">
            SQLSTATE 40001
          </code>{" "}
          instead of silently losing the update. Run the same race with and
          without LedgerLoop&apos;s bounded OCC retry and compare the outcomes.
        </p>
      </header>

      <div className="mt-8">
        <ConcurrencyDemoRunner action={runDemoAction} />
      </div>
    </main>
  );
}
