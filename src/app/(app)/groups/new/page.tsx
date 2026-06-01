import { CreateGroupForm } from "./create-group-form";
import { isValidCurrency } from "../../../../domain/money";

/**
 * Create group page (Req 3.5).
 *
 * Fields: group name, base currency.
 * On success shows invite/add-members affordance.
 */

export interface CreateGroupState {
  success?: boolean;
  groupId?: string;
  groupName?: string;
  fieldErrors?: Record<string, string>;
  values?: { name: string; baseCurrency: string };
}

async function createGroupAction(
  _prevState: CreateGroupState,
  formData: FormData,
): Promise<CreateGroupState> {
  "use server";

  const name = (formData.get("name") as string)?.trim() ?? "";
  const baseCurrency = (formData.get("baseCurrency") as string)?.trim().toUpperCase() ?? "USD";

  const values = { name, baseCurrency };
  const fieldErrors: Record<string, string> = {};

  // Validate group name (Req 3.1, 3.3)
  if (!name) {
    fieldErrors.name = "Group name is required";
  } else if (name.length > 100) {
    fieldErrors.name = "Group name must be 100 characters or fewer";
  }

  // Validate base currency (Req 3.2)
  if (!isValidCurrency(baseCurrency)) {
    fieldErrors.baseCurrency = "Please enter a valid currency code (e.g. USD, GBP, NGN)";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  // Create group (in MVP, in-memory)
  const groupId = crypto.randomUUID();

  // TODO: Wire to persistence layer — insertGroup + insertMembership for creator

  return {
    success: true,
    groupId,
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
