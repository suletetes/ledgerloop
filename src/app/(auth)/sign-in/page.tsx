import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { signIn, SESSION_COOKIE_NAME, getSession } from "../../../lib/auth";
import { SignInForm } from "./sign-in-form";

/**
 * Sign-in page (Req 2.1, 2.2, 17.4, 17.5, 22.4).
 *
 * - Non-enumerating error message on failure (Req 2.2)
 * - Redirects to /groups on success
 * - Preserves email input on rejection (Req 22.4)
 */

export interface SignInState {
  error?: string;
  values?: { email: string };
}

async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  "use server";

  const email = (formData.get("email") as string)?.trim() ?? "";
  const password = (formData.get("password") as string) ?? "";

  if (!email || !password) {
    return {
      error: "Invalid credentials",
      values: { email },
    };
  }

  const result = signIn(email, password);

  if (!result.ok) {
    // Non-enumerating error message (Req 2.2)
    return {
      error: result.error ?? "Invalid credentials",
      values: { email },
    };
  }

  // Set session cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.token ?? "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

  redirect("/groups");
}

export default async function SignInPage() {
  // If already authenticated, redirect to groups
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (getSession(sessionToken)) {
    redirect("/groups");
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-neutral-900">Sign in</h1>
      <SignInForm action={signInAction} />
    </>
  );
}
