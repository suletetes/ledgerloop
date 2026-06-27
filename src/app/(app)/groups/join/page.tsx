import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getSessionAsync } from "../../../../lib/auth";
import { getPersistence } from "../../../../lib/persistence-factory";
import { joinGroup } from "../../../../ledger/services";
import { JoinGroupForm } from "./join-group-form";

/**
 * Join group page — lets a signed-in user join an existing group by ID.
 */

export interface JoinGroupState {
  success?: boolean;
  groupId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: { groupId: string };
}

async function joinGroupAction(
  _prevState: JoinGroupState,
  formData: FormData,
): Promise<JoinGroupState> {
  "use server";

  const groupId = (formData.get("groupId") as string)?.trim() ?? "";

  if (!groupId) {
    return { fieldErrors: { groupId: "Group ID is required" }, values: { groupId } };
  }

  // Basic UUID shape check
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(groupId)) {
    return {
      fieldErrors: { groupId: "That doesn't look like a valid group ID" },
      values: { groupId },
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = await getSessionAsync(token);

  if (!userId) {
    redirect("/sign-in");
  }

  const persistence = getPersistence();
  const result = await joinGroup(persistence, { groupId, userId });

  if (!result.ok) {
    const msg =
      result.error.category === "not_found"
        ? "No group found with that ID. Double-check and try again."
        : result.error.message;
    return { error: msg, values: { groupId } };
  }

  redirect(`/groups/${groupId}`);
}

export default function JoinGroupPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Join a group</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste the group ID shared with you by the group creator.
      </p>
      <div className="mt-6">
        <JoinGroupForm action={joinGroupAction} />
      </div>
    </div>
  );
}
