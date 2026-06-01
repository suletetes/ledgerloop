/**
 * Property 26: PII is excluded from logs and cross-member messages.
 *
 * For any operation, emitted log entries contain no email address or other PII,
 * and for any error or diagnostic message presented to a member, the message
 * contains no other member's email address.
 *
 * Feature: ledgerloop-app, Property 26: PII is excluded from logs and cross-member messages
 *
 * Validates: Requirements 21.3, 21.4
 */

import { describe, it, beforeEach } from "vitest";
import { fc, assertProperty } from "../helpers/property";
import {
  stripPii,
  PII_REDACTED,
  log,
  getLogEntries,
  clearLogEntries,
  setConsoleOutput,
} from "@/lib/logger";
import { mapDomainErrorToResponse } from "@/lib/api-response";
import type { DomainError, DomainErrorCategory } from "@/domain/result";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a realistic email address. */
const arbEmail = fc
  .tuple(
    fc.array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789._+-".split(""))), { minLength: 1, maxLength: 20 }).map((a) => a.join("")),
    fc.array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz0123456789.-".split(""))), { minLength: 1, maxLength: 15 }).map((a) => a.join("")),
    fc.array(fc.constantFrom(...("abcdefghijklmnopqrstuvwxyz".split(""))), { minLength: 2, maxLength: 6 }).map((a) => a.join("")),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generate a string that contains one or more email addresses embedded in text. */
const arbTextWithEmail = fc
  .tuple(
    fc.string({ minLength: 0, maxLength: 50 }),
    arbEmail,
    fc.string({ minLength: 0, maxLength: 50 }),
  )
  .map(([prefix, email, suffix]) => `${prefix} ${email} ${suffix}`);

/** Generate a DomainError category. */
const arbCategory: fc.Arbitrary<DomainErrorCategory> = fc.constantFrom(
  "validation",
  "authorization",
  "not_found",
  "referential_integrity",
  "invariant",
  "conflict_exhausted",
  "unavailable",
);

// ─── Email detection helper ──────────────────────────────────────────────────

const EMAIL_DETECT_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function containsEmail(text: string): boolean {
  return EMAIL_DETECT_REGEX.test(text);
}

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Property 26: PII is excluded from logs and cross-member messages", () => {
  beforeEach(() => {
    clearLogEntries();
    setConsoleOutput(false);
  });

  // Feature: ledgerloop-app, Property 26: PII is excluded from logs and cross-member messages
  it("stripPii removes all email addresses from any string", () => {
    assertProperty(
      fc.property(arbTextWithEmail, (text) => {
        const stripped = stripPii(text);
        // The stripped text must not contain any email address
        EMAIL_DETECT_REGEX.lastIndex = 0;
        return !containsEmail(stripped);
      }),
    );
  });

  it("log entries never contain email addresses regardless of input", () => {
    assertProperty(
      fc.property(
        arbTextWithEmail,
        fc.constantFrom("info", "warn", "error", "debug") as fc.Arbitrary<"info" | "warn" | "error" | "debug">,
        (message, level) => {
          clearLogEntries();
          log(level, message);
          const entries = getLogEntries();
          // Every log entry message must be PII-free
          for (const entry of entries) {
            EMAIL_DETECT_REGEX.lastIndex = 0;
            if (containsEmail(entry.message)) return false;
          }
          return true;
        },
      ),
    );
  });

  it("log context values never contain email addresses", () => {
    assertProperty(
      fc.property(
        arbTextWithEmail,
        fc.string({ minLength: 1, maxLength: 20 }),
        (emailText, key) => {
          clearLogEntries();
          log("info", "operation", { [key]: emailText });
          const entries = getLogEntries();
          for (const entry of entries) {
            if (entry.context) {
              for (const value of Object.values(entry.context)) {
                if (typeof value === "string") {
                  EMAIL_DETECT_REGEX.lastIndex = 0;
                  if (containsEmail(value)) return false;
                }
              }
            }
          }
          return true;
        },
      ),
    );
  });

  it("DomainError-to-response mapping strips PII from error messages", () => {
    assertProperty(
      fc.property(
        arbCategory,
        arbTextWithEmail,
        (category, messageWithEmail) => {
          const domainError: DomainError = {
            category,
            message: messageWithEmail,
          };
          const response = mapDomainErrorToResponse(domainError);
          // The response message must not contain any email
          EMAIL_DETECT_REGEX.lastIndex = 0;
          return !containsEmail(response.body.error.message);
        },
      ),
    );
  });

  it("stripPii replaces emails with the REDACTED placeholder", () => {
    assertProperty(
      fc.property(arbEmail, (email) => {
        const text = `User ${email} performed an action`;
        const stripped = stripPii(text);
        return stripped.includes(PII_REDACTED) && !stripped.includes(email);
      }),
    );
  });
});
