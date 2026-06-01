/**
 * DSQL connection module — IAM-token-authenticated, SSL-required, pooled.
 *
 * Uses the `postgres` (porsager) client over DSQL's PostgreSQL wire protocol.
 * The password is a freshly generated IAM auth token (short-lived), not a
 * static secret. Connections are reused across invocations (connection pooling).
 *
 * Environment variables:
 *   - DSQL_HOST     — the DSQL cluster endpoint
 *   - DSQL_REGION   — the AWS region (e.g. 'us-east-1')
 *   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN (optional)
 *
 * Design references: Architecture §8, Req 19.6.
 */

import postgres from "postgres";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

/** Cached SQL connection instance — reused across invocations. */
let cachedSql: ReturnType<typeof postgres> | null = null;

/**
 * Generate a fresh IAM auth token for DSQL connection.
 */
async function generateAuthToken(): Promise<string> {
  const host = process.env.DSQL_HOST;
  const region = process.env.DSQL_REGION ?? "us-east-1";

  if (!host) {
    throw new Error("DSQL_HOST environment variable is required");
  }

  const signer = new DsqlSigner({
    hostname: host,
    region,
  });

  return signer.getDbConnectAdminAuthToken();
}

/**
 * Get a pooled database connection to Aurora DSQL.
 *
 * The connection uses:
 *   - IAM token auth (freshly generated token as password)
 *   - sslmode=require
 *   - Connection reuse across invocations
 *
 * @returns A `postgres` SQL tagged-template client.
 */
export async function getDsqlConnection(): Promise<ReturnType<typeof postgres>> {
  if (cachedSql) {
    return cachedSql;
  }

  const host = process.env.DSQL_HOST;
  const region = process.env.DSQL_REGION ?? "us-east-1";

  if (!host) {
    throw new Error("DSQL_HOST environment variable is required");
  }

  const token = await generateAuthToken();

  cachedSql = postgres({
    host,
    port: 5432,
    database: "postgres",
    username: "admin",
    password: token,
    ssl: "require",
    // Connection pool settings for serverless reuse
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return cachedSql;
}

/**
 * Close the cached connection (for graceful shutdown / testing).
 */
export async function closeDsqlConnection(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end();
    cachedSql = null;
  }
}
