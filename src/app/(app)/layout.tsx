/**
 * App segment layout (Req 2.3, 19.5).
 *
 * Session guard temporarily disabled for development/preview.
 * To re-enable: uncomment the imports and the guard block below.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Auth guard disabled for dev preview — to re-enable, add these imports
  // at the top and uncomment the block:
  //
  // import { cookies } from "next/headers";
  // import { redirect } from "next/navigation";
  // import { SESSION_COOKIE_NAME, getSession } from "../../lib/auth";
  //
  // const cookieStore = await cookies();
  // const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  // const userId = getSession(sessionToken);
  // if (!userId) {
  //   redirect("/sign-in");
  // }

  return <>{children}</>;
}
