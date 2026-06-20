import { cookies } from "next/headers";
import { CreateGroupForm } from "./create-group-form";
import { isValidCurrency } from "../../../../domain/money";
import { getPersistence } from "../../../../lib/persistence-factory";
import { createGroup } from "../../../../ledger/services";
import { SESSION_COOKIE_NAME, getSession } from "../../../../lib/auth";

/**
 * Create group page (Req 3.5).
 * Persists through createGroup service which inserts group + creator membership.
 */

export interface CreateGroupState {
  success?: boolean;
  groupId?: string;
  groupName?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: { name: string; baseCurrency: string };
}

async function createGroupAction(
  _prevState: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  "use server";

  const name = (formData.get("name") as string)?.trim() ?? "";
  const baseCurrency = (formData.get("baseCurrency") as string)?.trim().toUpperCase() || "USD";

  const values = { name, baseCurrency };
  const fieldErrors: Record<string, string> = {};

  if (!name) {
    fieldErrors.name = "Group name is required";
  } else if (name.length > 100) {
    fieldErrors.name = "Group name must be 100 characters or fewer";
  }

  if (!isValidCurrency(baseCurrency)) {
    fieldErrors.baseCurrency = "Please enter a valid currency code (e.g. USD, GBP, NGN)";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  // Get the current user from session
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = getSession(token);

  if (!userId) {
    return { error: "You must be signed in to create a group.", values };
  }

  // Persist group + creator membership
  const persistence = getPersistence();
  const result = await createGroup(persistence, {
    name,
    baseCurrency,
    creatorId: userId,
  });

  if (!result.ok) {
    return { error: result.error.message, values };
  }

  return {
    success: true,
    groupId: result.value,
    groupName: name,
    values,
  };
}

export default function NewGroupPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Create a group</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Start splitting expenses with friends, family, or roommates.
      </p>
      <div className="mt-6">
        <CreateGroupForm action={createGroupAction} />
      </div>
    </div>
  );
}
