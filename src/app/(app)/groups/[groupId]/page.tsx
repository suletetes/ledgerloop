import Link from "next/link";
import { BalanceSummary } from "../../../../components/balance/BalanceSummary";
import { SimplifiedPlan } from "../../../../components/balance/SimplifiedPlan";

/**
 * Group view page — Server Component shell (Req 16.1, 16.2, 10.5).
 *
 * Renders BalanceSummary, SimplifiedPlan, and links to add expense / settle up.
 * Client Components handle interactivity and live updates.
 */

interface GroupViewProps {
  params: Promise<{ groupId: string }>;
}

export default async function GroupViewPage({ params }: GroupViewProps) {
  const { groupId } = await params;

  // In the MVP, group data would be fetched from the ledger service.
  // For now, we render the shell with placeholder data.
  const groupName = "Group"; // TODO: fetch from persistence

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/groups"
            className="text-sm text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
          >
            ← All groups
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{groupName}</h1>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/groups/${groupId}/add-expense`}
          className="inline-flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          Add expense
        </Link>
        <Link
          href={`/groups/${groupId}/settle`}
          className="inline-flex min-h-touch items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          Settle up
        </Link>
      </div>

      {/* Balance Summary (Req 16.1, 16.2, 9.5, 9.6, 17.6) */}
      <section className="mt-8" aria-labelledby="balance-heading">
        <h2 id="balance-heading" className="text-lg font-medium text-neutral-900">
          Balances
        </h2>
        <div className="mt-3">
          <BalanceSummary
            groupId={groupId}
            currentUserId="current-user" // TODO: pass from session
            members={[]}
          />
        </div>
      </section>

      {/* Simplified Plan (Req 10.5, 10.8) */}
      <section className="mt-8" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="text-lg font-medium text-neutral-900">
          Suggested payments
        </h2>
        <div className="mt-3">
          <SimplifiedPlan
            groupId={groupId}
            viewerCurrency="USD" // TODO: pass from user preference
            members={[]}
          />
        </div>
      </section>
    </div>
  );
}
