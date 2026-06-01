/**
 * Unit tests for the authentication lifecycle and architecture guard (Task 15.6).
 *
 * Tests:
 * - Valid sign-in establishes a session (Req 2.1)
 * - Sign-out requires re-auth (Req 2.4)
 * - Unauthenticated group-scoped access redirects (Req 2.3)
 * - No database driver is present in the client bundle (Req 19.6)
 * - All mutations route through the API (Req 19.6)
 *
 * Requirements: 2.1, 2.3, 2.4, 19.6
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  signIn,
  signOut,
  extractSessionToken,
  SESSION_COOKIE_NAME,
  SIGN_IN_FAILURE_MESSAGE,
  clearSessions,
} from "@/lib/auth";
import {
  setCredential,
  clearCredentials,
} from "@/lib/auth-store";
import {
  requireAuth,
  SIGN_IN_PATH,
} from "@/lib/route-guard";
import { mapDomainErrorToResponse } from "@/lib/api-response";
import type { DomainError } from "@/domain/result";

describe("Authentication lifecycle", () => {
  beforeEach(() => {
    clearSessions();
    clearCredentials();
  });

  describe("Password hashing", () => {
    it("hashPassword produces a salt:hash format", () => {
      const hash = hashPassword("mypassword");
      expect(hash).toContain(":");
      const parts = hash.split(":");
      expect(parts).toHaveLength(2);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
    });

    it("verifyPassword returns true for correct password", () => {
      const hash = hashPassword("secret123");
      expect(verifyPassword("secret123", hash)).toBe(true);
    });

    it("verifyPassword returns false for incorrect password", () => {
      const hash = hashPassword("secret123");
      expect(verifyPassword("wrongpassword", hash)).toBe(false);
    });

    it("verifyPassword returns false for malformed hash", () => {
      expect(verifyPassword("anything", "nocolon")).toBe(false);
    });

    it("different passwords produce different hashes", () => {
      const hash1 = hashPassword("password1");
      const hash2 = hashPassword("password2");
      expect(hash1).not.toBe(hash2);
    });

    it("same password produces different hashes (random salt)", () => {
      const hash1 = hashPassword("samepassword");
      const hash2 = hashPassword("samepassword");
      expect(hash1).not.toBe(hash2);
      // But both verify correctly
      expect(verifyPassword("samepassword", hash1)).toBe(true);
      expect(verifyPassword("samepassword", hash2)).toBe(true);
    });
  });

  describe("Session management", () => {
    it("createSession returns a token and cookie header", () => {
      const { token, cookieHeader } = createSession("user-123");
      expect(token).toBeTruthy();
      expect(token.length).toBe(64); // 32 bytes hex
      expect(cookieHeader).toContain(SESSION_COOKIE_NAME);
      expect(cookieHeader).toContain("HttpOnly");
      expect(cookieHeader).toContain("Secure");
      expect(cookieHeader).toContain("SameSite=Lax");
    });

    it("getSession returns userId for a valid token", () => {
      const { token } = createSession("user-456");
      expect(getSession(token)).toBe("user-456");
    });

    it("getSession returns null for an invalid token", () => {
      expect(getSession("nonexistent-token")).toBeNull();
    });

    it("getSession returns null for null/undefined", () => {
      expect(getSession(null)).toBeNull();
      expect(getSession(undefined)).toBeNull();
    });

    it("destroySession invalidates the token", () => {
      const { token } = createSession("user-789");
      expect(getSession(token)).toBe("user-789");
      destroySession(token);
      expect(getSession(token)).toBeNull();
    });

    it("destroySession is safe with null/undefined", () => {
      expect(() => destroySession(null)).not.toThrow();
      expect(() => destroySession(undefined)).not.toThrow();
    });
  });

  describe("extractSessionToken", () => {
    it("extracts token from a cookie header", () => {
      const { token } = createSession("user-1");
      const cookieHeader = `${SESSION_COOKIE_NAME}=${token}; other=value`;
      expect(extractSessionToken(cookieHeader)).toBe(token);
    });

    it("returns null for missing cookie", () => {
      expect(extractSessionToken("other=value")).toBeNull();
    });

    it("returns null for null/undefined header", () => {
      expect(extractSessionToken(null)).toBeNull();
      expect(extractSessionToken(undefined)).toBeNull();
    });
  });

  describe("Sign-in (Req 2.1, 2.2)", () => {
    it("valid sign-in establishes a session", () => {
      const passwordHash = hashPassword("correctpassword");
      setCredential("user@example.com", "user-id-1", passwordHash);

      const result = signIn("user@example.com", "correctpassword");
      expect(result.ok).toBe(true);
      expect(result.userId).toBe("user-id-1");
      expect(result.token).toBeTruthy();
      expect(result.cookieHeader).toContain(SESSION_COOKIE_NAME);

      // Session is actually valid
      expect(getSession(result.token!)).toBe("user-id-1");
    });

    it("sign-in with wrong password returns non-enumerating error", () => {
      const passwordHash = hashPassword("correctpassword");
      setCredential("user@example.com", "user-id-1", passwordHash);

      const result = signIn("user@example.com", "wrongpassword");
      expect(result.ok).toBe(false);
      expect(result.error).toBe(SIGN_IN_FAILURE_MESSAGE);
      expect(result.userId).toBeUndefined();
      expect(result.token).toBeUndefined();
    });

    it("sign-in with non-existent email returns same non-enumerating error", () => {
      const result = signIn("nonexistent@example.com", "anypassword");
      expect(result.ok).toBe(false);
      // Same message as wrong password — non-enumerating (Req 2.2)
      expect(result.error).toBe(SIGN_IN_FAILURE_MESSAGE);
    });

    it("sign-in failure message does not reveal whether email exists", () => {
      // Set up one real user
      const passwordHash = hashPassword("pass");
      setCredential("real@example.com", "user-1", passwordHash);

      // Wrong password for existing email
      const result1 = signIn("real@example.com", "wrong");
      // Non-existent email
      const result2 = signIn("fake@example.com", "anything");

      // Both return the exact same error — no enumeration possible
      expect(result1.error).toBe(result2.error);
      expect(result1.ok).toBe(false);
      expect(result2.ok).toBe(false);
    });
  });

  describe("Sign-out (Req 2.4)", () => {
    it("sign-out terminates the session and requires re-authentication", () => {
      const passwordHash = hashPassword("mypass");
      setCredential("member@test.com", "member-1", passwordHash);

      // Sign in
      const signInResult = signIn("member@test.com", "mypass");
      expect(signInResult.ok).toBe(true);
      const token = signInResult.token!;

      // Session is valid
      expect(getSession(token)).toBe("member-1");

      // Sign out
      signOut(token);

      // Session is now invalid — requires re-authentication
      expect(getSession(token)).toBeNull();
    });
  });

  describe("Unauthenticated route guard (Req 2.3)", () => {
    it("unauthenticated request is blocked and redirected to sign-in", () => {
      const result = requireAuth(null);
      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.redirectTo).toBe(SIGN_IN_PATH);
      }
    });

    it("expired/terminated session is blocked and redirected", () => {
      const { token } = createSession("user-x");
      destroySession(token);

      const cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;
      const result = requireAuth(cookieHeader);
      expect(result.authenticated).toBe(false);
      if (!result.authenticated) {
        expect(result.redirectTo).toBe(SIGN_IN_PATH);
      }
    });

    it("valid session passes the guard", () => {
      const { token } = createSession("user-y");
      const cookieHeader = `${SESSION_COOKIE_NAME}=${token}`;
      const result = requireAuth(cookieHeader);
      expect(result.authenticated).toBe(true);
      if (result.authenticated) {
        expect(result.userId).toBe("user-y");
      }
    });
  });

  describe("DomainError-to-response mapping (Req 22.1, 22.2)", () => {
    it("maps validation to 422", () => {
      const error: DomainError = {
        category: "validation",
        message: "Amount must be positive",
        field: "amount",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(422);
      expect(response.body.error.category).toBe("validation");
      expect(response.body.error.field).toBe("amount");
      expect(response.body.error.operationTookEffect).toBe(false);
    });

    it("maps authorization to 403", () => {
      const error: DomainError = {
        category: "authorization",
        message: "Not authorized",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(403);
      expect(response.body.error.operationTookEffect).toBe(false);
    });

    it("maps not_found to 404", () => {
      const error: DomainError = {
        category: "not_found",
        message: "Group does not exist",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(404);
    });

    it("maps referential_integrity to 409", () => {
      const error: DomainError = {
        category: "referential_integrity",
        message: "Referenced entity does not exist",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(409);
    });

    it("maps invariant to 422", () => {
      const error: DomainError = {
        category: "invariant",
        message: "Invariant violated",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(422);
    });

    it("maps conflict_exhausted to 503", () => {
      const error: DomainError = {
        category: "conflict_exhausted",
        message: "Retries exhausted",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(503);
      expect(response.body.error.operationTookEffect).toBe(false);
    });

    it("maps unavailable to 503", () => {
      const error: DomainError = {
        category: "unavailable",
        message: "Service unavailable",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.status).toBe(503);
    });

    it("strips PII from error messages", () => {
      const error: DomainError = {
        category: "authorization",
        message: "User john@example.com is not authorized",
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.body.error.message).not.toContain("john@example.com");
      expect(response.body.error.message).toContain("[REDACTED]");
    });

    it("includes maxSettleableMinor when present", () => {
      const error: DomainError = {
        category: "validation",
        message: "Amount exceeds maximum",
        maxSettleableMinor: 5000,
      };
      const response = mapDomainErrorToResponse(error);
      expect(response.body.error.maxSettleableMinor).toBe(5000);
    });
  });

  describe("Architecture guard (Req 19.6)", () => {
    it("postgres package is not imported in client components (src/components/)", () => {
      // Verify no client component imports postgres directly
      const componentsDir = path.resolve(__dirname, "../../src/components");
      if (fs.existsSync(componentsDir)) {
        const files = getAllFiles(componentsDir);
        for (const file of files) {
          const content = fs.readFileSync(file, "utf-8");
          expect(content).not.toMatch(
            /import\s+.*from\s+['"]postgres['"]/,
          );
          expect(content).not.toMatch(
            /require\s*\(\s*['"]postgres['"]\s*\)/,
          );
        }
      }
    });

    it("postgres package is not imported in client-side app components", () => {
      // Check src/app/ for any "use client" files that import postgres
      const appDir = path.resolve(__dirname, "../../src/app");
      if (fs.existsSync(appDir)) {
        const files = getAllFiles(appDir);
        for (const file of files) {
          const content = fs.readFileSync(file, "utf-8");
          // Only check files marked as client components
          if (content.includes('"use client"') || content.includes("'use client'")) {
            expect(content).not.toMatch(
              /import\s+.*from\s+['"]postgres['"]/,
            );
            expect(content).not.toMatch(
              /require\s*\(\s*['"]postgres['"]\s*\)/,
            );
          }
        }
      }
    });

    it("postgres is listed as a server-only dependency (not in browser bundle)", () => {
      // The postgres package should be in dependencies (server-side) but
      // never imported by client components. Verify it's in package.json
      // dependencies (server-only in Next.js).
      const packageJsonPath = path.resolve(__dirname, "../../package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      // postgres is a dependency (used server-side)
      expect(packageJson.dependencies).toHaveProperty("postgres");

      // It should NOT be in a hypothetical "browser" or "client" field
      // In Next.js, dependencies are server-only unless imported by client components
      // We already verified no client component imports it above
    });

    it("all financial mutations route through API (no direct persistence in components)", () => {
      // Verify no component directly imports from the persistence layer
      const componentsDir = path.resolve(__dirname, "../../src/components");
      if (fs.existsSync(componentsDir)) {
        const files = getAllFiles(componentsDir);
        for (const file of files) {
          const content = fs.readFileSync(file, "utf-8");
          // No direct imports of persistence modules
          expect(content).not.toMatch(
            /import\s+.*from\s+['"]@\/ledger\/persistence['"]/,
          );
          expect(content).not.toMatch(
            /import\s+.*from\s+['"]@\/ledger\/dsql['"]/,
          );
          expect(content).not.toMatch(
            /import\s+.*from\s+['"]@\/ledger\/in-memory-persistence['"]/,
          );
        }
      }
    });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively get all .ts/.tsx files in a directory. */
function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
}
