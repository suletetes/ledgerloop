/**
 * Aurora PostgreSQL connection module.
 *
 * Uses the `postgres` (porsager) client over Aurora's PostgreSQL wire protocol.
 * Connection is TLS-encrypted (ssl: "require") and authenticated with a
 * password stored in Vercel env vars (sourced from Secrets Manager at setup).
 *
 * Environment variables:
 *   - AURORA_HOST     — the Aurora writer endpoint
 *   - AURORA_PORT     — port (default 5432)
 *   - AURORA_DB       — database name (default "ledgerloop")
 *   - AURORA_USER     — master username
 *   - AURORA_PASSWORD — master password
 */

import postgres from "postgres";

/** Cached SQL connection instance — reused across invocations. */
let cachedSql: ReturnType<typeof postgres> | null = null;

/**
 * Get a pooled database connection to Aurora PostgreSQL.
 *
 * The connection uses:
 *   - Password auth (from AURORA_PASSWORD env var)
 *   - sslmode=require (Aurora requires TLS)
 *   - Connection reuse across invocations (warm serverless instances)
 *   - SERIALIZABLE isolation (set at DB level; 40001 on conflicts)
 *
 * @returns A `postgres` SQL tagged-template client.
 */
export function getAuroraConnection(): ReturnType<typeof postgres> {
  if (cachedSql) {
    return cachedSql;
  }

  const host = process.env.AURORA_HOST;
  const port = parseInt(process.env.AURORA_PORT ?? "5432", 10);
  const database = process.env.AURORA_DB ?? "ledgerloop";
  const username = process.env.AURORA_USER;
  const password = process.env.AURORA_PASSWORD;

  if (!host) {
    throw new Error("AURORA_HOST environment variable is required");
  }
  if (!username) {
    throw new Error("AURORA_USER environment variable is required");
  }
  if (!password) {
    throw new Error("AURORA_PASSWORD environment variable is required");
  }

  cachedSql = postgres({
    host,
    port,
    database,
    username,
    password,
    ssl: "require",
    // Connection pool settings for serverless reuse
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,  // 30s to handle Aurora Serverless v2 cold start
  });

  return cachedSql;
}

/**
 * Close the cached connection (for graceful shutdown / testing).
 */
export async function closeAuroraConnection(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end();
    cachedSql = null;
  }
}
