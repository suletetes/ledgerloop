import Link from "next/link";

/**
 * Landing page with a clear value proposition and CTAs.
 */
export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-20 text-center">
      {/* Hero */}
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl">
          Split expenses.<br />
          <span className="text-brand-600">Never lose a cent.</span>
        </h1>
        <p className="mx-auto max-w-xl text-lg text-neutral-600">
          LedgerLoop tracks shared costs across groups, simplifies tangled debts
          into the fewest payments, and guarantees your balances stay correct
          even when two people edit at the same second from different continents.
        </p>
      </div>

      {/* CTAs */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/register"
          className="inline-flex min-h-touch items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          Get started free
        </Link>
        <Link
          href="/sign-in"
          className="inline-flex min-h-touch items-center justify-center rounded-lg border border-neutral-300 px-6 py-3 text-base font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          Sign in
        </Link>
      </div>

      {/* Feature highlights */}
      <div className="mt-8 grid w-full gap-6 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-left shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 text-lg font-bold">
            ÷
          </div>
          <h3 className="font-semibold text-neutral-900">Fair splits</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Equal, percentage, or exact amounts. Remainders are distributed
            deterministically so no unit ever vanishes.
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-left shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success text-lg font-bold">
            ↘
          </div>
          <h3 className="font-semibold text-neutral-900">Simplified debts</h3>
          <p className="mt-1 text-sm text-neutral-500">
            12 tangled IOUs reduced to 4 payments. The min-cashflow algorithm
            finds the fewest transfers to zero everyone out.
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-left shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 text-lg font-bold">
            ⚡
          </div>
          <h3 className="font-semibold text-neutral-900">Concurrent-safe</h3>
          <p className="mt-1 text-sm text-neutral-500">
            Two edits at the same instant? Aurora DSQL aborts the conflict and
            retries transparently. Your balance never silently breaks.
          </p>
        </div>
      </div>
    </section>
  );
}
