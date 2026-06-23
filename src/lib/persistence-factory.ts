/**
 * Persistence factory — returns the right Persistence implementation based on
 * environment.
 *
 * Selection order:
 *   1. AURORA_HOST set → AuroraPersistence (production, Aurora PostgreSQL)
 *   2. DSQL_HOST set → DsqlPersistence (legacy/alternative)
 *   3. Neither → InMemoryPersistence (local dev, preview deploys)
 *
 * The instance is cached as a module-level singleton, which on Vercel persists
 * for the life of the serverless function warm instance.
 */

import type { Persistence } from "@/ledger/persistence";
import { InMemoryPersistence } from "@/ledger/in-memory-persistence";

let cached: Persistence | null = null;

/**
 * Get the shared Persistence instance.
 */
export function getPersistence(): Persistence {
  if (cached) return cached;

  if (process.env.AURORA_HOST) {
    // Aurora PostgreSQL (primary production path)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuroraPersistence } = require("@/ledger/aurora") as typeof import("@/ledger/aurora");
    cached = new AuroraPersistence();
  } else if (process.env.DSQL_HOST) {
    // Aurora DSQL (fallback if DSQL access is granted)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DsqlPersistence } = require("@/ledger/dsql") as typeof import("@/ledger/dsql");
    cached = new DsqlPersistence();
  } else {
    // In-memory fake (local dev / preview)
    cached = new InMemoryPersistence();
  }

  return cached;
}
