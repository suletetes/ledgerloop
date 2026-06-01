/**
 * Auth segment layout — wraps registration and sign-in pages.
 *
 * This is a Server Component (Req 19.5) that provides a centered, minimal
 * layout for unauthenticated flows. No session check is needed here since
 * these pages are accessible without authentication.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
