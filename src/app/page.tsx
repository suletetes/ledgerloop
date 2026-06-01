/**
 * Placeholder landing page so the App Router has a real route. Core flows
 * (groups, balances, add-expense, settle-up) are implemented in later tasks.
 */
export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-3xl font-bold text-neutral-900">LedgerLoop</h1>
      <p className="text-base text-neutral-600">
        Multi-region group expense ledger. Shared balances stay correct even
        when group members in different regions edit at the same instant.
      </p>
    </section>
  );
}
