/**
 * DSQL module — real Aurora DSQL persistence and connection.
 *
 * Exports:
 *   - DsqlPersistence: real Persistence implementation against DSQL
 *   - getDsqlConnection: pooled IAM-token-authenticated connection
 *   - closeDsqlConnection: graceful shutdown helper
 */

export { DsqlPersistence } from "./dsql-persistence";
export { getDsqlConnection, closeDsqlConnection } from "./connection";
