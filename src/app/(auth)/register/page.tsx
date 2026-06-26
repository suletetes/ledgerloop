import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { hashPassword, createSession, SESSION_COOKIE_NAME, getSessionAsync } from "../../../lib/auth";
import { setCredentialAsync } from "../../../lib/auth-store";
import { isValidCurrency } from "../../../domain/money";
import { getPersistence } from "../../../lib/persistence-factory";
import { registerMember } from "../../../ledger/services";
import { RegisterForm } from "./register-form";

/**
 * Registration page (Req 1.1, 17.4, 17.5, 22.4).
 *
 * Server Component that handles the registration server action.
 * Persists the user into the ledger via registerMember service.
 */

export interface RegisterState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: {
    displayName: string;
    email: string;
    homeRegion: string;
    currencyPref: string;
  };
}

async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  "use server";

  const displayName = (formData.get("displayName") as string)?.trim() ?? "";
  const email = (formData.get("email") as string)?.trim() ?? "";
  const password = (formData.get("password") as string) ?? "";
  const homeRegion = (formData.get("homeRegion") as string)?.trim() ?? "";
  const currencyPref = (formData.get("currencyPref") as string)?.trim().toUpperCase() || "USD";

  const values = { displayName, email, homeRegion, currencyPref };
  const fieldErrors: Record<string, string> = {};

  if (!displayName || displayName.length === 0) {
    fieldErrors.displayName = "Display name is required";
  } else if (displayName.length > 100) {
    fieldErrors.displayName = "Display name must be 100 characters or fewer";
  }

  if (!email) {
    fieldErrors.email = "Email is required";
  } else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (!password) {
    fieldErrors.password = "Password is required";
  } else if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters";
  }

  if (!homeRegion) {
    fieldErrors.homeRegion = "Home region is required";
  }

  if (currencyPref && !isValidCurrency(currencyPref)) {
    fieldErrors.currencyPref = "Please enter a valid currency code (e.g. USD, GBP)";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  // Persist user into the ledger (retry once on connection timeout for Aurora cold start)
  const persistence = getPersistence();
  let result = await registerMember(persistence, { displayName, email, homeRegion });

  if (!result.ok && result.error.message.includes("CONNECT_TIMEOUT")) {
    // Aurora Serverless v2 cold start — retry once
    result = await registerMember(persistence, { displayName, email, homeRegion });
  }

  if (!result.ok) {
    return { error: result.error.message, values };
  }

  const userId = result.value;

  // Update currency preference if not default
  if (currencyPref !== "USD") {
    const { updateCurrencyPreference } = await import("../../../ledger/services");
    await updateCurrencyPreference(persistence, userId, currencyPref);
  }

  // Store auth credential and create session
  const passwordHash = hashPassword(password);
  await setCredentialAsync(email, userId, passwordHash);

  const { token } = createSession(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/groups");
}

export default async function RegisterPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (await getSessionAsync(sessionToken)) {
    redirect("/groups");
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-neutral-900">Create an account</h1>
      <p className="text-sm text-neutral-500">Start splitting expenses with your group.</p>
      <RegisterForm action={registerAction} />
    </>
  );
}
