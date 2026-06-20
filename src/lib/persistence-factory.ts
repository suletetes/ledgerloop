/**
 * Persistence factory — returns the right Persistence implementation based on
 * environment. Uses InMemoryPersistence for local dev (no DSQL_HOST set) and
 * DsqlPersistence in production.
 *
 * The instance is cached as a module-level singleton, which on Vercel persists
 * for the life of the serverless function (warm instances share state; cold
 * starts get a fresh instance). For local dev with InMemoryPersistence, the
 * singleton keeps data alive across requests in the same `npm run dev` process.
 */

import type { Persistence } from "@/ledger/persistence";
import { InMemoryPersistence } from "@/ledger/in-memory-persistence";

let cached: Persistence | null = null;

/**
 * Get the shared Persistence instance.
 *
 * - When DSQL_HOST is set: returns DsqlPersistence (production).
 * - Otherwise: returns a singleton InMemoryPersistence (local dev).
 */
export function getPersistence(): Persistence {
  if (cached) return cached;

  if (process.env.DSQL_HOST) {
    // Lazy-import to avoid loading DSQL deps in local dev
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DsqlPersistence } = require("@/ledger/dsql") as typeof import("@/ledger/dsql");
    cached = new DsqlPersistence();
  } else {
    cached = new InMemoryPersistence();
  }

  return cached;
}
