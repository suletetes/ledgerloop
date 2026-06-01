import type { Metadata, Viewport } from "next";
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
            <span className="text-lg font-semibold text-brand-700">
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
          <div className="mx-auto max-w-5xl px-4 py-4 text-center text-xs text-neutral-500">
            LedgerLoop — Multi-region group expense ledger
          </div>
        </footer>
      </body>
    </html>
  );
}
