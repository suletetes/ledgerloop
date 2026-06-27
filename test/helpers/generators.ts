/**
 * Base `fast-check` generators for LedgerLoop (task 1.2, Req 19.2).
 *
 * These reusable arbitraries feed the property-based suite that locks down the
 * correctness invariants in later tasks. They deliberately include the edge
 * cases called out in the design's Testing Strategy prework:
 *   - currency codes: valid ISO-4217 and invalid / non-ISO codes
 *   - money: positive integer minor units as safe `number` AND `bigint`,
 *     including values above `Number.MAX_SAFE_INTEGER` and near `2^63 − 1`
 *   - strings: whitespace-only and over-length (>100 and >500 chars)
 *   - reference graphs: member / group / membership relationships
 *
 * Only the generators are defined here; the domain types they ultimately feed
 * (`ExpenseInput`, `SettlementInput`, `LedgerSnapshot`, …) arrive in later
 * tasks, so these are intentionally typed against plain shapes.
 */
import fc from "fast-check";
import { isValidCurrency } from "@/domain/money";

// ---------------------------------------------------------------------------
// Currency codes (ISO-4217 vs non-ISO)
// ---------------------------------------------------------------------------

/**
 * A representative set of valid ISO-4217 three-letter codes spanning the
 * minor-digit variety the money utilities must handle: 2-digit-minor
 * currencies (USD, NGN, EUR, GBP, CAD), a 0-digit-minor currency (JPY), and a
 * 3-digit-minor currency (BHD).
 */
export const ISO_4217_CODES = [
  "USD",
  "NGN",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "BHD",
] as const;

export type Iso4217Code = (typeof ISO_4217_CODES)[number];

/** A valid ISO-4217 currency code drawn from the representative set. */
export function iso4217Code(): fc.Arbitrary<Iso4217Code> {
  return fc.constantFrom(...ISO_4217_CODES);
}

/**
 * Codes that are NOT valid ISO-4217 currency codes. Covers the shapes a
 * validator must reject: wrong length, lowercase, digits, padded/whitespace,
 * empty, and plausible-but-unassigned three-letter strings.
 *
 * The filter uses `isValidCurrency` (the full CURRENCY_MINOR_DIGITS table)
 * so any code the app accepts is never labelled as invalid here.
 */
export function nonIso4217Code(): fc.Arbitrary<string> {
  return fc.oneof(
    // Wrong length (0, 1, 2, or 4+ letters).
    fc
      .string({ unit: "grapheme-ascii", minLength: 0, maxLength: 6 })
      .filter((s) => s.length !== 3),
    // Right length but contains a non-uppercase-letter character.
    fc
      .string({ minLength: 3, maxLength: 3 })
      .filter((s) => !/^[A-Z]{3}$/.test(s)),
    // Lowercased version of a real code (case matters for ISO-4217).
    iso4217Code().map((c) => c.toLowerCase()),
    // Three uppercase letters that are NOT accepted by isValidCurrency.
    fc
      .tuple(
        fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")),
        fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")),
        fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")),
      )
      .map(([a, b, c]) => `${a}${b}${c}`)
      .filter((s) => !isValidCurrency(s)),
  );
}

// ---------------------------------------------------------------------------
// Money — positive integer minor units (INV-4)
// ---------------------------------------------------------------------------

/** Upper bound for monetary amounts: `2^63 − 1` (BIGINT max), per Req 6.2/6.9. */
export const MAX_AMOUNT_MINOR = 9_223_372_036_854_775_807n;

/**
 * A positive integer minor-units amount that is provably within JavaScript's
 * safe-integer range (`1 .. Number.MAX_SAFE_INTEGER`). Use where the value is
 * known to be representable as a `number` without precision loss.
 */
export function safeAmountMinorNumber(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });
}

/**
 * A positive integer minor-units amount as a `bigint` across the FULL legal
 * range `1 .. 2^63 − 1`. This exercises values above
 * `Number.MAX_SAFE_INTEGER` where only `bigint` keeps INV-4 exact.
 */
export function amountMinorBigInt(): fc.Arbitrary<bigint> {
  return fc.bigInt({ min: 1n, max: MAX_AMOUNT_MINOR });
}

/**
 * A `bigint` amount concentrated NEAR the `2^63 − 1` ceiling so tests probe the
 * top of the BIGINT range (the region most likely to overflow naive `number`
 * arithmetic). Spans roughly the top ~4 billion minor units.
 */
export function amountMinorNearMaxBigInt(): fc.Arbitrary<bigint> {
  const window = 0xff_ff_ff_ffn; // ~2^32
  return fc
    .bigInt({ min: 0n, max: window })
    .map((delta) => MAX_AMOUNT_MINOR - delta);
}

/**
 * Any legal positive amount, mixing safe-`number`-range values, full-range
 * `bigint` values, and values clustered near `2^63 − 1`. Always yields a
 * `bigint` so callers have a single integer type to reason about.
 */
export function amountMinor(): fc.Arbitrary<bigint> {
  return fc.oneof(
    safeAmountMinorNumber().map((n) => BigInt(n)),
    amountMinorBigInt(),
    amountMinorNearMaxBigInt(),
  );
}

// ---------------------------------------------------------------------------
// Strings — whitespace-only and over-length
// ---------------------------------------------------------------------------

const WHITESPACE_UNITS = [" ", "\t", "\n", "\r", "\f", "\v", "\u00a0"] as const;

/**
 * A non-empty string made up exclusively of whitespace characters. These must
 * be rejected wherever a non-whitespace value is required (display names,
 * descriptions).
 */
export function whitespaceOnlyString(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...WHITESPACE_UNITS), { minLength: 1, maxLength: 20 })
    .map((parts) => parts.join(""));
}

/**
 * A string strictly longer than `minOverLength` characters (default 100), for
 * exercising the display-name limit (1–100 chars).
 */
export function overLengthString(minOverLength = 100): fc.Arbitrary<string> {
  return fc.string({
    unit: "grapheme-ascii",
    minLength: minOverLength + 1,
    maxLength: minOverLength + 50,
  });
}

/**
 * A string strictly longer than 500 characters, for exercising the description
 * limit (≤500 chars).
 */
export function overLengthDescription(): fc.Arbitrary<string> {
  return overLengthString(500);
}

// ---------------------------------------------------------------------------
// Member / group / membership graphs
// ---------------------------------------------------------------------------

export interface MemberNode {
  id: string;
}

export interface GroupNode {
  id: string;
}

export interface MembershipEdge {
  groupId: string;
  userId: string;
}

export interface MembershipGraph {
  members: MemberNode[];
  groups: GroupNode[];
  memberships: MembershipEdge[];
}

/** A UUID, matching the application-generated identifiers used for all rows. */
export function uuid(): fc.Arbitrary<string> {
  return fc.uuid();
}

/** A member node with an application-style UUID identifier. */
export function memberNode(): fc.Arbitrary<MemberNode> {
  return uuid().map((id) => ({ id }));
}

/** A group node with an application-style UUID identifier. */
export function groupNode(): fc.Arbitrary<GroupNode> {
  return uuid().map((id) => ({ id }));
}

/**
 * A member/group/membership graph with distinct member and group ids and a
 * subset of `(group, member)` membership edges. Each edge references a member
 * and group that exist in the graph, and edges are unique on
 * `(groupId, userId)` — the same uniqueness the persistence layer enforces.
 *
 * The generator can produce groups with no members and members in no group,
 * so consumers see the full range of referential situations (including the
 * non-member references that Auth_Guard / referential-integrity checks reject).
 */
export function membershipGraph(
  opts: { maxMembers?: number; maxGroups?: number } = {},
): fc.Arbitrary<MembershipGraph> {
  const maxMembers = opts.maxMembers ?? 6;
  const maxGroups = opts.maxGroups ?? 4;

  return fc
    .tuple(
      fc.uniqueArray(uuid(), { minLength: 1, maxLength: maxMembers }),
      fc.uniqueArray(uuid(), { minLength: 1, maxLength: maxGroups }),
    )
    .chain(([memberIds, groupIds]) => {
      const allPairs: MembershipEdge[] = [];
      for (const groupId of groupIds) {
        for (const userId of memberIds) {
          allPairs.push({ groupId, userId });
        }
      }
      return fc
        .subarray(allPairs, { minLength: 0, maxLength: allPairs.length })
        .map((memberships) => ({
          members: memberIds.map((id) => ({ id })),
          groups: groupIds.map((id) => ({ id })),
          memberships,
        }));
    });
}

/** Re-export `fast-check` for convenience alongside the generators. */
export { fc };
