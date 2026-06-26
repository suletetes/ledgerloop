import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getSessionAsync } from "../../../lib/auth";
import { getPersistence } from "../../../lib/persistence-factory";

/**
 * Groups list page  Server Component.
 * Fetches real groups from persistence for the current user.
 */

interface GroupSummary {
  id: string;
  name: string;
  baseCurrency: string;
  memberCount: number;
}

async function getGroups(userId: string): Promise<GroupSummary[]> {
  const persistence = getPersistence();
  // Works against both the in-memory fake and the real Aurora adapter.
  return persistence.getGroupsForUser(userId);
}

export default async function GroupsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = await getSessionAsync(token);

  // Auth guard in layout ensures userId is always set here
  const groups = userId ? await getGroups(userId) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Your Groups</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {groups.length > 0
              ? `${groups.length} group${groups.length !== 1 ? "s" : ""}`
              : "Create or join a group to start"}
          </p>
        </div>
        <Link
          href="/groups/new"
          className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 transition-colors"
        >
          + New group
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 p-12 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-2xl">
            👥
          </div>
          <p className="font-medium text-neutral-700">No groups yet</p>
          <p className="mt-1 text-sm text-neutral-500">
            Create a group to start splitting expenses with friends.
          </p>
          <Link
            href="/groups/new"
            className="mt-4 inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            Create your first group
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3" role="list">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="block rounded-xl border border-neutral-200 bg-white p-5 shadow-sm hover:border-brand-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-neutral-900">{group.name}</h2>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {group.memberCount} member{group.memberCount !== 1 ? "s" : ""} · {group.baseCurrency}
                    </p>
                  </div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-400" aria-hidden="true">
                    →
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
