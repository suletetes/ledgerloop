import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getSessionAsync } from "../../lib/auth";

/**
 * Session-guarded app segment layout (Req 2.3, 19.5).
 *
 * Checks for an authenticated session before rendering any group-scoped
 * content. If no valid session exists, redirects to sign-in.
 * Sessions persist in Aurora so this works across serverless cold starts.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = await getSessionAsync(sessionToken);

  if (!userId) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
