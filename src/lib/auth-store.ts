/**
 * Auth Store — server-only credential store for the MVP.
 *
 * Keeps email → { userId, passwordHash } mappings separate from the users
 * table to maintain PII minimization (Req 21.2). The users table stores only
 * display name, email, home region, and currency preference; password hashes
 * live here.
 *
 * For the MVP/hackathon this is an in-memory store. A production system would
 * persist hashes in a dedicated auth table or use an external identity provider.
 */

export interface AuthCredential {
  userId: string;
  passwordHash: string;
}

/**
 * In-memory auth credential store.
 * Maps email (lowercased) → credential.
 */
const store = new Map<string, AuthCredential>();

export function setCredential(
  email: string,
  userId: string,
  passwordHash: string,
): void {
  store.set(email.toLowerCase(), { userId, passwordHash });
}

export function getCredential(email: string): AuthCredential | undefined {
  return store.get(email.toLowerCase());
}

export function removeCredential(email: string): void {
  store.delete(email.toLowerCase());
}

/** Clear all credentials (useful for tests). */
export function clearCredentials(): void {
  store.clear();
}
