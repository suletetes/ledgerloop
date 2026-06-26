"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, destroySession } from "../lib/auth";

/**
 * Sign out server action — destroys the session and redirects to landing.
 */
export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  destroySession(token);
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/");
}
