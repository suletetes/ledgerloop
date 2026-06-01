import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  getSession,
} from "../../lib/auth";

/**
 * Session-guarded app segment layout (Req 2.3, 19.5).
 *
 * This Server Component checks for an authenticated session before rendering
 * any group-scoped content. If no valid session exists, the user is redirected
 * to the sign-in page. Client Components for interactivity are rendered as
 * children within this authenticated shell.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const userId = getSession(sessionToken);

  if (!userId) {
    redirect("/sign-in");
  }

  return <>{children}</>;
}
