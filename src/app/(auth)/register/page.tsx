import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { hashPassword, createSession, SESSION_COOKIE_NAME, getSession } from "../../../lib/auth";
import { setCredential } from "../../../lib/auth-store";
import { isValidCurrency } from "../../../domain/money";
import { RegisterForm } from "./register-form";

/**
 * Registration page (Req 1.1, 17.4, 17.5, 22.4).
 *
 * Server Component that handles the registration server action.
 * Fields: display name, email, password, home region.
 * Accessible: every input has a label, errors shown as text (aria-describedby).
 * Preserves input on rejection (Req 22.4).
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
  const currencyPref = (formData.get("currencyPref") as string)?.trim().toUpperCase() ?? "USD";

  const values = { displayName, email, homeRegion, currencyPref };
  const fieldErrors: Record<string, string> = {};

  // Validate display name (Req 1.1, 1.3)
  if (!displayName || displayName.length === 0) {
    fieldErrors.displayName = "Display name is required";
  } else if (displayName.length > 100) {
    fieldErrors.displayName = "Display name must be 100 characters or fewer";
  }

  // Validate email (Req 1.1, 1.4)
  if (!email) {
    fieldErrors.email = "Email is required";
  } else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }

  // Validate password
  if (!password) {
    fieldErrors.password = "Password is required";
  } else if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters";
  }

  // Validate home region
  if (!homeRegion) {
    fieldErrors.homeRegion = "Home region is required";
  }

  // Validate currency preference (Req 1.5)
  if (currencyPref && !isValidCurrency(currencyPref)) {
    fieldErrors.currencyPref = "Please enter a valid currency code (e.g. USD, GBP)";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  // Create user
  const userId = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  setCredential(email, userId, passwordHash);

  // Create session
  const { cookieHeader } = createSession(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieHeader.split("=")[1]?.split(";")[0] ?? "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  redirect("/groups");
}

export default async function RegisterPage() {
  // If already authenticated, redirect to groups
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (getSession(sessionToken)) {
    redirect("/groups");
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-neutral-900">Create an account</h1>
      <RegisterForm action={registerAction} />
    </>
  );
}
