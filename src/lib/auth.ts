/**
 * Session authentication module (Task 15.1).
 *
 * Provides:
 * - hashPassword / verifyPassword — crypto-based password hashing
 * - createSession — sets an HTTP-only cookie with the member id
 * - getSession — reads the cookie and returns the member id or null
 * - destroySession — clears the session cookie
 * - signIn — verifies credentials and establishes a session
 * - signOut — terminates the session
 *
 * Requirements:
 * - 2.1: Valid credentials establish an authenticated session
 * - 2.2: Sign-in failure uses a single non-enumerating message ("Invalid credentials")
 * - 2.4: Sign-out terminates the session and requires re-authentication
 *
 * Security:
 * - HTTP-only cookie prevents XSS access to the session token
 * - Non-enumerating error message never reveals whether an email exists
 * - Password hashing uses PBKDF2 with a random salt (crypto module, no external deps)
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getCredential } from "./auth-store";

// ─── Password Hashing ────────────────────────────────────────────────────────

const HASH_ALGORITHM = "sha256";
const SALT_LENGTH = 16;
const HASH_ITERATIONS = 10000;

/**
 * Hash a password with a random salt using HMAC-SHA256 iterated.
 * Returns a string in the format: salt:hash (both hex-encoded).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = deriveHash(password, salt);
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash string (salt:hash format).
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, expectedHash] = parts as [string, string];
  const actualHash = deriveHash(password, salt);

  // Timing-safe comparison
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function deriveHash(password: string, salt: string): string {
  let result = password;
  for (let i = 0; i < HASH_ITERATIONS; i++) {
    result = createHmac(HASH_ALGORITHM, salt).update(result).digest("hex");
  }
  return result;
}

// ─── Session Management ──────────────────────────────────────────────────────

/** The cookie name used for the session. */
export const SESSION_COOKIE_NAME = "ledgerloop_session";

/** Session token → userId mapping (in-memory for MVP). */
const sessions = new Map<string, string>();

/**
 * Create a session for the given user id.
 * Returns the session token and cookie header value.
 */
export function createSession(userId: string): {
  token: string;
  cookieHeader: string;
} {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, userId);

  const cookieHeader = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Secure",
  ].join("; ");

  return { token, cookieHeader };
}

/**
 * Get the user id from a session token.
 * Returns null if the session is invalid or expired.
 */
export function getSession(token: string | undefined | null): string | null {
  if (!token) return null;
  return sessions.get(token) ?? null;
}

/**
 * Destroy a session, requiring re-authentication for subsequent requests.
 */
export function destroySession(token: string | undefined | null): void {
  if (token) {
    sessions.delete(token);
  }
}

/**
 * Extract the session token from a cookie header string.
 */
export function extractSessionToken(
  cookieHeader: string | undefined | null,
): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name?.trim() === SESSION_COOKIE_NAME) {
      return valueParts.join("=") || null;
    }
  }
  return null;
}

// ─── Sign-In / Sign-Out ──────────────────────────────────────────────────────

/** The single non-enumerating error message for sign-in failures (Req 2.2). */
export const SIGN_IN_FAILURE_MESSAGE = "Invalid credentials";

export interface SignInResult {
  ok: boolean;
  userId?: string;
  token?: string;
  cookieHeader?: string;
  error?: string;
}

/**
 * Verify credentials and establish a session (Req 2.1, 2.2).
 *
 * On failure, returns a single non-enumerating message that does not reveal
 * whether the email address exists.
 */
export function signIn(email: string, password: string): SignInResult {
  const credential = getCredential(email);

  // Non-enumerating: same message whether email doesn't exist or password is wrong
  if (!credential) {
    return { ok: false, error: SIGN_IN_FAILURE_MESSAGE };
  }

  if (!verifyPassword(password, credential.passwordHash)) {
    return { ok: false, error: SIGN_IN_FAILURE_MESSAGE };
  }

  const { token, cookieHeader } = createSession(credential.userId);
  return { ok: true, userId: credential.userId, token, cookieHeader };
}

/**
 * Terminate a session (Req 2.4).
 * After sign-out, the token is invalid and re-authentication is required.
 */
export function signOut(token: string | undefined | null): void {
  destroySession(token);
}

/** Clear all sessions (useful for tests). */
export function clearSessions(): void {
  sessions.clear();
}
