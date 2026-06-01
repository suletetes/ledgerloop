/**
 * DDL/schema smoke tests — file-content assertions against schema.sql.
 *
 * These tests validate the DSQL-safe DDL without requiring a live database.
 * They read the schema.sql file and assert structural properties.
 *
 * Task 14.4: DDL/schema smoke test (Req 13.4, 19.6)
 * Task 14.5: Data-minimization schema smoke test (Req 21.1, 21.2)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schemaPath = resolve(__dirname, "../../../src/ledger/dsql/schema.sql");
const schema = readFileSync(schemaPath, "utf-8");

/** Strip SQL comments (lines starting with --) to avoid false positives. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const schemaNoComments = stripComments(schema);

describe("DSQL schema DDL smoke tests (Task 14.4)", () => {
  it("uses CREATE INDEX ASYNC (not plain CREATE INDEX)", () => {
    // All CREATE INDEX statements should be ASYNC
    const allIndexStatements =
      schemaNoComments.match(/CREATE\s+(UNIQUE\s+)?INDEX/gi) ?? [];
    expect(allIndexStatements.length).toBeGreaterThan(0);

    // Every CREATE INDEX must include ASYNC
    const asyncIndexStatements =
      schemaNoComments.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+ASYNC/gi) ?? [];
    expect(asyncIndexStatements.length).toBe(allIndexStatements.length);
  });

  it("contains no FOREIGN KEY constraints", () => {
    expect(schemaNoComments.toUpperCase()).not.toContain("FOREIGN KEY");
    expect(schemaNoComments.toUpperCase()).not.toContain("REFERENCES");
  });

  it("contains no SERIAL or SEQUENCE", () => {
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bSERIAL\b/);
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bSEQUENCE\b/);
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bBIGSERIAL\b/);
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bSMALLSERIAL\b/);
  });

  it("contains no TRIGGER", () => {
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bTRIGGER\b/);
  });

  it("contains no VIEW", () => {
    expect(schemaNoComments.toUpperCase()).not.toMatch(
      /CREATE\s+(OR\s+REPLACE\s+)?VIEW/,
    );
  });

  it("contains no JSON or JSONB column types", () => {
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bJSON\b/);
    expect(schemaNoComments.toUpperCase()).not.toMatch(/\bJSONB\b/);
  });

  it("uses BIGINT for amount columns", () => {
    expect(schemaNoComments).toMatch(/amount_minor\s+BIGINT/i);
    expect(schemaNoComments).toMatch(/share_minor\s+BIGINT/i);
  });

  it("contains the unique index on (group_id, user_id)", () => {
    expect(schemaNoComments).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+ASYNC\s+\w+\s+ON\s+group_members\s*\(\s*group_id\s*,\s*user_id\s*\)/i,
    );
  });
});

describe("Data-minimization schema smoke tests (Task 14.5)", () => {
  it("users table has only the expected columns", () => {
    // Extract the CREATE TABLE users block
    const usersTableMatch = schemaNoComments.match(
      /CREATE\s+TABLE\s+users\s*\(([\s\S]*?)\);/i,
    );
    expect(usersTableMatch).not.toBeNull();
    const usersBlock = usersTableMatch?.[1] ?? "";
    expect(usersBlock.length).toBeGreaterThan(0);

    // Expected columns
    const expectedColumns = [
      "id",
      "display_name",
      "email",
      "home_region",
      "currency_pref",
      "created_at",
    ];

    for (const col of expectedColumns) {
      expect(usersBlock).toContain(col);
    }
  });

  it("users table does not contain sensitive financial columns", () => {
    const usersTableMatch = schemaNoComments.match(
      /CREATE\s+TABLE\s+users\s*\(([\s\S]*?)\);/i,
    );
    expect(usersTableMatch).not.toBeNull();
    const usersBlock = usersTableMatch?.[1]?.toLowerCase() ?? "";
    expect(usersBlock.length).toBeGreaterThan(0);

    // No card, bank, account, payment, credential, ssn columns
    const forbiddenColumns = [
      "card",
      "bank",
      "account",
      "payment",
      "credential",
      "ssn",
      "social_security",
      "routing",
      "iban",
      "swift",
      "pin",
      "cvv",
      "expiry",
    ];

    for (const col of forbiddenColumns) {
      expect(usersBlock).not.toContain(col);
    }
  });
});
