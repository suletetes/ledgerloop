import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getSession } from "../../../../lib/auth";
import { getPersistence } from "../../../../lib/persistence-factory";
import { deriveNetPositions } from "../../../../domain/balance-engine";
import { simplifyDebts } from "../../../../domain/debt-simplifier";
import { formatMinor } from "../../../../domain/money";
import { AddExpenseFlow } from "../../../../components/expense/AddExpenseFlow";
import { SettleUpForm } from "../../../../components/settle/SettleUpForm";
import { addExpenseAction } from "./actions";
/**
 * Group view page  shows real balances, simplified debts, and actions.
 */

interface GroupViewProps {
  params: Promise<{ groupId: string }>;
}

export default async function GroupViewPage({ params }: GroupViewProps) {
  const { groupId } = await params;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  let currentUserId = getSession(token);

  // Fallback for serverless session loss: use most recent user from DB
  const persistence = getPersistence();
  if (!currentUserId && "getRecentUserIdAsync" in persistence) {
    currentUserId = await (persistence as { getRecentUserIdAsync: () => Promise<string | null> }).getRecentUserIdAsync();
  }

  if (!currentUserId) {
    notFound();
  }

  // Get group info — works against both the in-memory fake and real Aurora.
  const group = await persistence.getGroup(groupId);
  if (!group) {
    notFound();
  }
  const groupName = group.name;
  const baseCurrency = group.baseCurrency;

  // Get members
  const members = await persistence.getGroupMembers(groupId);

  // Load ledger and derive balances
  const snapshot = await persistence.loadLedger(groupId);
  const netPositions = deriveNetPositions(snapshot);
  const transfers = simplifyDebts(netPositions);

  // Get display name for a user
  const nameOf = (id: string) =>
    members.find((m) => m.userId === id)?.displayName ?? id.slice(0, 8);

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
          <p className="text-sm text-neutral-500">
            {members.length} member{members.length !== 1 ? "s" : ""} · {baseCurrency}
          </p>
        </div>
      </div>

      {/* Balances section */}
      <section className="mt-8" aria-labelledby="balance-heading">
        <h2 id="balance-heading" className="text-lg font-semibold text-neutral-900">
          Balances
        </h2>
        {members.length === 0 || snapshot.expenses.length === 0 ? (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center">
            <p className="text-sm text-neutral-500">No expenses yet. Add one below to see balances.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2" role="list" aria-live="polite">
            {members.map((m) => {
              const pos = netPositions.get(m.userId) ?? 0;
              const isPositive = pos > 0;
              const isNegative = pos < 0;
              return (
                <li key={m.userId} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
                  <span className="font-medium text-neutral-900">
                    {m.displayName}
                    {m.userId === currentUserId && (
                      <span className="ml-1.5 text-xs text-neutral-400">(you)</span>
                    )}
                  </span>
                  <span className={`font-semibold tabular-nums ${isPositive ? "text-success" : isNegative ? "text-danger" : "text-neutral-500"}`}>
                    {isPositive ? "+" : ""}{formatMinor(Math.abs(pos), baseCurrency)}
                    {isPositive && <span className="ml-1 text-xs font-normal">owed to them</span>}
                    {isNegative && <span className="ml-1 text-xs font-normal">owes</span>}
                    {pos === 0 && <span className="ml-1 text-xs font-normal">settled</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Simplified payments section */}
      {transfers.length > 0 && (
        <section className="mt-8" aria-labelledby="plan-heading">
          <h2 id="plan-heading" className="text-lg font-semibold text-neutral-900">
            Suggested payments
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {transfers.length} payment{transfers.length !== 1 ? "s" : ""} to settle all debts
          </p>
          <ul className="mt-3 space-y-2" role="list">
            {transfers.map((t, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <span className="text-neutral-700">
                  <span className="font-medium">{nameOf(t.from)}</span>
                  {" → "}
                  <span className="font-medium">{nameOf(t.to)}</span>
                </span>
                <span className="font-semibold tabular-nums text-neutral-900">
                  {formatMinor(t.amountMinor, baseCurrency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions */}
      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-semibold text-neutral-900">Actions</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <AddExpenseFlow
            groupId={groupId}
            members={members.map((m) => ({ id: m.userId, displayName: m.displayName }))}
            currentUserId={currentUserId}
            baseCurrency={baseCurrency}
            addExpenseAction={addExpenseAction}
          />
        </div>

        {transfers.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <SettleUpForm
              groupId={groupId}
              members={members.map((m) => ({ id: m.userId, displayName: m.displayName }))}
              currentUserId={currentUserId}
              currency={baseCurrency}
            />
          </div>
        )}
      </section>
    </div>
  );
}
