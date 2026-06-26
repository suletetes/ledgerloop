/**
 * Auth Store — credential store that persists to Aurora in production.
 *
 * On Vercel (AURORA_HOST set): reads/writes credentials from the `credentials`
 * table so they survive serverless cold starts. On local dev (no AURORA_HOST):
 * uses an in-memory Map.
 */

export interface AuthCredential {
  userId: string;
  passwordHash: string;
}

// ─── In-memory fallback (local dev) ──────────────────────────────────────

const memStore = new Map<string, AuthCredential>();

// ─── Database-backed functions ───────────────────────────────────────────

function isAuroraMode(): boolean {
  return !!process.env.AURORA_HOST;
}

function getConnection() {
  // Lazy import to avoid loading postgres in non-Aurora environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getAuroraConnection } = require("../ledger/aurora/connection") as typeof import("../ledger/aurora/connection");
  return getAuroraConnection();
}

/**
 * Store a credential (email → userId + passwordHash).
 * In Aurora mode, persists to the credentials table.
 */
export async function setCredentialAsync(
  email: string,
  userId: string,
  passwordHash: string,
): Promise<void> {
  const key = email.toLowerCase();

  if (isAuroraMode()) {
    const sql = getConnection();
    await sql`
      INSERT INTO credentials (email, user_id, password_hash)
      VALUES (${key}, ${userId}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET user_id = ${userId}, password_hash = ${passwordHash}
    `;
  }

  // Always keep in-memory copy for same-instance reads
  memStore.set(key, { userId, passwordHash });
}

/**
 * Synchronous setter (backwards-compatible for existing callers).
 * Persists to memory immediately; fires-and-forgets the DB write.
 */
export function setCredential(
  email: string,
  userId: string,
  passwordHash: string,
): void {
  const key = email.toLowerCase();
  memStore.set(key, { userId, passwordHash });

  // Fire-and-forget DB persist (don't block the caller)
  if (isAuroraMode()) {
    setCredentialAsync(email, userId, passwordHash).catch(() => {
      // Silently fail — the in-memory store is the primary for this request
    });
  }
}

/**
 * Look up a credential by email.
 * Checks in-memory first (fast path), falls back to Aurora if not found.
 */
export async function getCredentialAsync(email: string): Promise<AuthCredential | undefined> {
  const key = email.toLowerCase();

  // Fast path: check in-memory
  const mem = memStore.get(key);
  if (mem) return mem;

  // Slow path: query Aurora
  if (isAuroraMode()) {
    try {
      const sql = getConnection();
      const rows = await sql`
        SELECT user_id, password_hash FROM credentials WHERE email = ${key} LIMIT 1
      `;
      if (rows.length > 0 && rows[0]) {
        const cred: AuthCredential = {
          userId: rows[0].user_id as string,
          passwordHash: rows[0].password_hash as string,
        };
        // Cache for subsequent reads in this instance
        memStore.set(key, cred);
        return cred;
      }
    } catch {
      // Connection failure — fall through to undefined
    }
  }

  return undefined;
}

/**
 * Synchronous getter (backwards-compatible). Only checks in-memory.
 * For production sign-in, use getCredentialAsync instead.
 */
export function getCredential(email: string): AuthCredential | undefined {
  return memStore.get(email.toLowerCase());
}

export function removeCredential(email: string): void {
  memStore.delete(email.toLowerCase());
}

export function clearCredentials(): void {
  memStore.clear();
}
