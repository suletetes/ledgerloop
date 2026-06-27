import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getSessionAsync } from "../lib/auth";
import { signOutAction } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerLoop",
  description:
    "Multi-region group expense ledger — shared balances stay correct even with concurrent edits.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout — top bar has logo only, navigation is a sticky bottom bar.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const isLoggedIn = !!(await getSessionAsync(sessionToken));

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-neutral-50 font-sans text-neutral-900 antialiased">
        {/* Skip-to-content link (Req 17.7) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-neutral-50"
        >
          Skip to content
        </a>

        {/* Top bar — logo only */}
        <header role="banner" className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link
              href={isLoggedIn ? "/groups" : "/"}
              className="flex items-center gap-2 text-lg font-semibold text-brand-700 hover:text-brand-800 transition-colors"
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect width="28" height="28" rx="6" fill="currentColor" fillOpacity="0.1"/>
                <path d="M8 20V8h2v10h6v2H8z" fill="currentColor"/>
                <path d="M12 14l4-6h2.5l-4 6 4 6H16l-4-6z" fill="currentColor" fillOpacity="0.6"/>
                <circle cx="20" cy="10" r="2.5" fill="currentColor" fillOpacity="0.8"/>
              </svg>
              LedgerLoop
            </Link>

            {/* Show minimal tech badge on desktop */}
            <p className="hidden sm:block text-xs text-neutral-400">
              Vercel · Aurora PostgreSQL
            </p>
          </div>
        </header>

        {/* Main content — extra bottom padding so the sticky nav doesn't cover content */}
        <main id="main-content" role="main" className="flex-grow mx-auto w-full max-w-5xl px-4 py-6 pb-24">
          {children}
        </main>

        {/* Sticky bottom navigation */}
        <nav
          role="navigation"
          aria-label="Main navigation"
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
        >
          <div className="mx-auto flex max-w-5xl items-center justify-around px-4 py-2 sm:justify-end sm:gap-4">
            {isLoggedIn ? (
              <>
                {/* Groups */}
                <Link
                  href="/groups"
                  className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-neutral-600 hover:text-brand-700 focus:outline-none focus:text-brand-700 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <span className="text-[10px] font-medium">Groups</span>
                </Link>

                {/* New group */}
                <Link
                  href="/groups/new"
                  className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-neutral-600 hover:text-brand-700 focus:outline-none focus:text-brand-700 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                  <span className="text-[10px] font-medium">New group</span>
                </Link>

                {/* Demo */}
                <Link
                  href="/demo/concurrency"
                  className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-neutral-600 hover:text-brand-700 focus:outline-none focus:text-brand-700 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span className="text-[10px] font-medium">Demo</span>
                </Link>

                {/* Sign out */}
                <form action={signOutAction} className="flex flex-col items-center">
                  <button
                    type="submit"
                    className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-neutral-600 hover:text-danger focus:outline-none focus:text-danger transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    <span className="text-[10px] font-medium">Sign out</span>
                  </button>
                </form>
              </>
            ) : (
              <>
                {/* Sign in */}
                <Link
                  href="/sign-in"
                  className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-neutral-600 hover:text-brand-700 focus:outline-none focus:text-brand-700 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  <span className="text-[10px] font-medium">Sign in</span>
                </Link>

                {/* Get started */}
                <Link
                  href="/register"
                  className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 text-brand-700 hover:text-brand-800 focus:outline-none transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="8.5" cy="7" r="4"/>
                    <line x1="20" y1="8" x2="20" y2="14"/>
                    <line x1="23" y1="11" x2="17" y2="11"/>
                  </svg>
                  <span className="text-[10px] font-medium">Get started</span>
                </Link>
              </>
            )}
          </div>
        </nav>
      </body>
    </html>
  );
}
