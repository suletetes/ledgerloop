import Link from "next/link";

/**
 * Groups list page — Server Component (Req 3.5, 4.4).
 *
 * Shows the member's groups and a link to create a new group.
 * In the MVP, groups are fetched from the in-memory persistence layer.
 * The actual data fetching will be wired when the persistence layer is connected.
 */

// Placeholder type for group data
interface GroupSummary {
  id: string;
  name: string;
  baseCurrency: string;
  memberCount: number;
}

// In the MVP, this would fetch from the ledger service.
// For now, we render the shell with an empty state.
async function getGroups(): Promise<GroupSummary[]> {
  // TODO: Wire to persistence layer when available
  return [];
}

export default async function GroupsPage() {
  const groups = await getGroups();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Your Groups</h1>
        <Link
          href="/groups/new"
          className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          New group
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center">
          <p className="text-neutral-600">You haven&apos;t joined any groups yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Create a group to start splitting expenses with friends.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3" role="list">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="block rounded-lg border border-neutral-200 p-4 hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-medium text-neutral-900">{group.name}</h2>
                    <p className="text-sm text-neutral-500">
                      {group.memberCount} member{group.memberCount !== 1 ? "s" : ""} · {group.baseCurrency}
                    </p>
                  </div>
                  <span className="text-neutral-400" aria-hidden="true">→</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
