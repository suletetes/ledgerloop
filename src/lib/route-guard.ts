/**
 * Route Guard — unauthenticated request blocking (Task 15.2).
 *
 * Blocks unauthenticated (expired/terminated) requests to group-scoped screens
 * and actions, redirecting them to the sign-in page.
 *
 * Requirements:
 * - 2.3: While a session is not actively established, restrict access to
 *   group-scoped screens and actions and redirect to sign-in.
 *
 * Usage:
 * - In route handlers: call `requireAuth(request)` which returns the userId
 *   or a redirect Response.
 * - In server components: call `getAuthenticatedUser(cookieHeader)` which
 *   returns the userId or null.
 */

import {
  getSession,
  extractSessionToken,
} from "./auth";

/** The path to redirect unauthenticated users to. */
export const SIGN_IN_PATH = "/sign-in";

export interface AuthResult {
  authenticated: true;
  userId: string;
}

export interface UnauthenticatedResult {
  authenticated: false;
  redirectTo: string;
}

export type RouteGuardResult = AuthResult | UnauthenticatedResult;

/**
 * Check if a request is authenticated. Returns the userId if authenticated,
 * or a redirect target if not.
 *
 * @param cookieHeader - The raw Cookie header from the request
 * @returns AuthResult with userId, or UnauthenticatedResult with redirect path
 */
export function requireAuth(
  cookieHeader: string | undefined | null,
): RouteGuardResult {
  const token = extractSessionToken(cookieHeader);
  const userId = getSession(token);

  if (!userId) {
    return { authenticated: false, redirectTo: SIGN_IN_PATH };
  }

  return { authenticated: true, userId };
}

/**
 * Get the authenticated user id from a cookie header, or null if not
 * authenticated. Simpler variant for cases where the caller handles the
 * redirect themselves.
 */
export function getAuthenticatedUser(
  cookieHeader: string | undefined | null,
): string | null {
  const token = extractSessionToken(cookieHeader);
  return getSession(token);
}
