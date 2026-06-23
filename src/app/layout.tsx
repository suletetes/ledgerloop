import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LedgerLoop",
  description:
    "Multi-region group expense ledger  shared balances stay correct even with concurrent edits.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout with accessible shell (Req 17.7, 19.5).
 *
 * Provides:
 * - Skip-to-content link for keyboard/screen-reader users (Req 17.7)
 * - ARIA landmarks: banner, navigation, main, contentinfo
 * - System font stack from design tokens (var(--font-sans) fallback)
 * - Server Component for initial render (Req 19.5)
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        {/* Skip-to-content link (Req 17.7) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-neutral-50"
        >
          Skip to content
        </a>

        {/* Banner landmark */}
        <header role="banner" className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-lg font-semibold text-brand-700">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect width="28" height="28" rx="6" fill="currentColor" fillOpacity="0.1"/>
                <path d="M8 20V8h2v10h6v2H8z" fill="currentColor"/>
                <path d="M12 14l4-6h2.5l-4 6 4 6H16l-4-6z" fill="currentColor" fillOpacity="0.6"/>
                <circle cx="20" cy="10" r="2.5" fill="currentColor" fillOpacity="0.8"/>
              </svg>
              LedgerLoop
            </span>
            {/* Navigation landmark */}
            <nav role="navigation" aria-label="Main navigation">
              {/* Navigation items rendered by child layouts */}
            </nav>
          </div>
        </header>

        {/* Main content landmark */}
        <main id="main-content" role="main" className="mx-auto max-w-5xl px-4 py-6">
          {children}
        </main>

        {/* Contentinfo landmark */}
        <footer role="contentinfo" className="border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-6">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-neutral-600">
                <svg width="18" height="18" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect width="28" height="28" rx="6" fill="currentColor" fillOpacity="0.1"/>
                  <path d="M8 20V8h2v10h6v2H8z" fill="currentColor"/>
                  <path d="M12 14l4-6h2.5l-4 6 4 6H16l-4-6z" fill="currentColor" fillOpacity="0.6"/>
                  <circle cx="20" cy="10" r="2.5" fill="currentColor" fillOpacity="0.8"/>
                </svg>
                <span>LedgerLoop</span>
              </div>
              <p className="text-xs text-neutral-400">
                Built for the H0 Hackathon — Vercel + Aurora PostgreSQL
              </p>
              <div className="flex gap-4 text-xs text-neutral-500">
                <span>Next.js</span>
                <span aria-hidden="true">·</span>
                <span>TypeScript</span>
                <span aria-hidden="true">·</span>
                <span>Aurora PostgreSQL</span>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
