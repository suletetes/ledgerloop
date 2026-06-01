/**
 * Harness smoke test (task 1.2, Req 19.2).
 *
 * Proves the Vitest + fast-check harness runs and that the property helper
 * enforces the ≥100-iteration floor from the design's Testing Strategy. This
 * is intentionally NOT a domain property test — the 27 design Properties are
 * implemented by later tasks (2.3, 2.4, 3.2, 3.4, 3.5, …). It also exercises
 * the base generators so a broken arbitrary is caught immediately.
 */
import { describe, it, expect } from "vitest";
import {
  assertProperty,
  assertAsyncProperty,
  resolveParameters,
  MIN_NUM_RUNS,
  fc,
} from "./helpers/property";
import {
  iso4217Code,
  nonIso4217Code,
  amountMinor,
  amountMinorNearMaxBigInt,
  whitespaceOnlyString,
  overLengthString,
  overLengthDescription,
  membershipGraph,
  ISO_4217_CODES,
  MAX_AMOUNT_MINOR,
} from "./helpers/generators";

describe("property-test helper", () => {
  it("raises an unspecified run count to the 100-iteration floor", () => {
    expect(resolveParameters().numRuns).toBe(MIN_NUM_RUNS);
  });

  it("raises a below-floor run count up to the floor", () => {
    expect(resolveParameters({ numRuns: 1 }).numRuns).toBe(MIN_NUM_RUNS);
    expect(resolveParameters({ numRuns: 99 }).numRuns).toBe(MIN_NUM_RUNS);
  });

  it("preserves an above-floor run count and other parameters", () => {
    const resolved = resolveParameters({ numRuns: 250, seed: 42 });
    expect(resolved.numRuns).toBe(250);
    expect(resolved.seed).toBe(42);
  });

  it("executes at least 100 iterations when running a property", () => {
    let iterations = 0;
    assertProperty(
      fc.property(fc.integer(), () => {
        iterations += 1;
        return true;
      }),
    );
    expect(iterations).toBeGreaterThanOrEqual(MIN_NUM_RUNS);
  });

  it("executes at least 100 iterations for an async property", async () => {
    let iterations = 0;
    await assertAsyncProperty(
      fc.asyncProperty(fc.integer(), async () => {
        iterations += 1;
        return true;
      }),
    );
    expect(iterations).toBeGreaterThanOrEqual(MIN_NUM_RUNS);
  });
});

describe("base generators", () => {
  it("iso4217Code only yields codes from the representative set", () => {
    assertProperty(
      fc.property(iso4217Code(), (code) => {
        expect(ISO_4217_CODES).toContain(code);
      }),
    );
  });

  it("nonIso4217Code never yields a known ISO-4217 code", () => {
    const known = new Set<string>(ISO_4217_CODES);
    assertProperty(
      fc.property(nonIso4217Code(), (code) => {
        expect(known.has(code)).toBe(false);
      }),
    );
  });

  it("amountMinor yields positive integers within the BIGINT range", () => {
    assertProperty(
      fc.property(amountMinor(), (amount) => {
        expect(typeof amount).toBe("bigint");
        expect(amount).toBeGreaterThanOrEqual(1n);
        expect(amount).toBeLessThanOrEqual(MAX_AMOUNT_MINOR);
      }),
    );
  });

  it("amountMinorNearMaxBigInt stays at or below 2^63 - 1", () => {
    assertProperty(
      fc.property(amountMinorNearMaxBigInt(), (amount) => {
        expect(amount).toBeLessThanOrEqual(MAX_AMOUNT_MINOR);
        // Beyond Number.MAX_SAFE_INTEGER, proving bigint is required here.
        expect(amount > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
      }),
    );
  });

  it("whitespaceOnlyString is non-empty and trims to empty", () => {
    assertProperty(
      fc.property(whitespaceOnlyString(), (s) => {
        expect(s.length).toBeGreaterThan(0);
        expect(s.trim()).toBe("");
      }),
    );
  });

  it("overLengthString exceeds 100 characters", () => {
    assertProperty(
      fc.property(overLengthString(), (s) => {
        expect(s.length).toBeGreaterThan(100);
      }),
    );
  });

  it("overLengthDescription exceeds 500 characters", () => {
    assertProperty(
      fc.property(overLengthDescription(), (s) => {
        expect(s.length).toBeGreaterThan(500);
      }),
    );
  });

  it("membershipGraph references only existing members and groups with unique edges", () => {
    assertProperty(
      fc.property(membershipGraph(), (graph) => {
        const memberIds = new Set(graph.members.map((m) => m.id));
        const groupIds = new Set(graph.groups.map((g) => g.id));
        const seen = new Set<string>();
        for (const edge of graph.memberships) {
          expect(memberIds.has(edge.userId)).toBe(true);
          expect(groupIds.has(edge.groupId)).toBe(true);
          const key = `${edge.groupId}::${edge.userId}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }),
    );
  });
});
