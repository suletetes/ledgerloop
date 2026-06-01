/**
 * Split_Calculator — computes per-member shares of an expense (INV-1).
 *
 * The Split_Calculator turns an expense amount and a split type into a list of
 * {@link Split} records whose `shareMinor` values sum **exactly** to the amount
 * (INV-1, Req 7.9). Every share is a non-negative integer in minor units
 * (Req 7.8); the calculator never produces a floating-point value (INV-4).
 *
 * This module implements all three splits: `equal` (Req 7.1, 7.2, 7.8),
 * `percent` (Req 7.3, 7.4, 7.8), and `exact` (Req 7.5, 7.6, 7.8). The fallible
 * `percent`/`exact` splits return a {@link Result} so a rejection produces
 * nothing and leaves the caller (and ultimately the ledger) unchanged. Each
 * split is exported both as a standalone function and as a method on the
 * {@link SplitCalculator} object, so callers can depend on either surface.
 */

import { err, ok, type Result } from "./result";
import type { Split } from "./types";

/**
 * Split an expense amount **equally** across an ordered set of members, with
 * deterministic distribution of the indivisible remainder (Req 7.1, 7.2).
 *
 * The amount is divided into a `base` share (`floor(amountMinor / n)`) that
 * every member receives, plus a `remainder` of leftover minor units
 * (`amountMinor − base * n`, always in `0 .. n − 1`). The remainder is handed
 * out one minor unit at a time to the **first** `remainder` members in array
 * order, so those members each pay exactly one extra minor unit.
 *
 * This construction guarantees, by integer arithmetic alone (no floating
 * point):
 *
 * - **Σ shareMinor === amountMinor (INV-1, Req 7.1).** The shares sum to
 *   `base * n + remainder`, which is `amountMinor` by definition of `base` and
 *   `remainder`.
 * - **Shares differ by at most one minor unit (Req 7.2).** Every share is
 *   either `base` or `base + 1`.
 * - **Determinism (Req 7.2).** The result is a pure function of `amountMinor`
 *   and the *ordered* `userIds`; identical ordered inputs always yield
 *   identical per-member shares.
 * - **Non-negative integer shares (Req 7.8).** For a positive integer amount
 *   and a non-empty member list, `base >= 0` and the per-member increment is
 *   `0` or `1`, so each `shareMinor` is a non-negative integer.
 *
 * @param amountMinor - The expense amount, a positive integer in minor units
 *                      (INV-4). Validation that the amount is a positive
 *                      integer happens upstream (tasks 6/12).
 * @param userIds     - The ordered, non-empty list of members sharing the
 *                      expense. The empty-set case is rejected upstream
 *                      (Req 6.4, 7.7), so this function is never called with
 *                      `n = 0`; a defensive guard throws if it is.
 * @returns One {@link Split} per member, positionally aligned to `userIds`,
 *          whose `shareMinor` values sum exactly to `amountMinor`.
 * @throws {RangeError} If `userIds` is empty (defensive; rejected upstream).
 */
export function equalSplit(amountMinor: number, userIds: string[]): Split[] {
  const n = userIds.length;
  if (n === 0) {
    // Defensive guard: the empty sharing set is rejected upstream (Req 7.7).
    // equalSplit must never divide by zero.
    throw new RangeError("equalSplit requires at least one member");
  }

  const base = Math.floor(amountMinor / n);
  const remainder = amountMinor - base * n; // integer in 0 .. n - 1

  return userIds.map((userId, index) => ({
    userId,
    shareMinor: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Split an expense amount **by percentage** across an ordered set of members,
 * distributing the indivisible rounding drift deterministically (Req 7.3, 7.4).
 *
 * ## Percent precision: integer percentages summing to 100
 *
 * Percentages are modelled as **integers that must sum to exactly 100**, the
 * simplest representation consistent with Req 7.4 ("the supplied percentages
 * [must] sum to 100 percent"). A non-integer percentage (e.g. `33.33`) is
 * rejected rather than silently rounded, so there is never a floating-point
 * percentage in play and the only rounding that occurs is the deterministic
 * minor-unit drift distribution below. `percents` is positional, aligned to
 * `userIds`.
 *
 * ## Algorithm (largest-remainder / Hamilton method)
 *
 * For each member `i` the *exact* share is `amountMinor * pctᵢ / 100`. The
 * integer floor of that, `floor(amountMinor * pctᵢ / 100)`, is computed with
 * integer arithmetic only — `amountMinor * pctᵢ` is formed first, then divided
 * — so no float is ever produced (INV-4). The sum of those floors is `≤
 * amountMinor`; the shortfall (`amountMinor − Σ floors`) is a non-negative
 * integer **leftover** of at most `n − 1` minor units. Each leftover unit is
 * handed out one at a time to the members with the largest fractional remainder
 * `(amountMinor * pctᵢ) mod 100`, ties broken by ascending member index
 * (participant order). This guarantees:
 *
 * - **Σ shareMinor === amountMinor (INV-1, Req 7.3).** The floors plus exactly
 *   the leftover count of +1 increments sum to `amountMinor` by construction.
 * - **Determinism.** Floors, remainders, and the index-ordered tie-break are
 *   pure functions of `amountMinor` and the ordered `(userIds, percents)`.
 * - **Non-negative integer shares (Req 7.8).** Floors of non-negative integer
 *   quotients are non-negative integers; increments only add `1`.
 *
 * Rejected as a `validation` {@link Result} (nothing is produced — Req 7.4):
 *   - `percents.length !== userIds.length` (a percentage per member is
 *     required), `field: "percents"`;
 *   - any percentage that is not a non-negative integer (e.g. negative or
 *     fractional), `field: "percents"`;
 *   - percentages that do not sum to exactly `100`, `field: "percents"`.
 *
 * @param amountMinor - The expense amount, a positive integer in minor units
 *                      (INV-4). Range validation happens upstream.
 * @param userIds     - The ordered, non-empty list of members sharing the
 *                      expense (the empty set is rejected upstream, Req 7.7).
 * @param percents    - Per-member integer percentages, positional and aligned
 *                      to `userIds`, that must sum to exactly 100.
 * @returns `ok(splits)` whose `shareMinor` values sum exactly to `amountMinor`,
 *          or a `validation` {@link Result} when the percentages are invalid.
 */
export function percentSplit(
  amountMinor: number,
  userIds: string[],
  percents: number[],
): Result<Split[]> {
  if (percents.length !== userIds.length) {
    return err<Split[]>(
      "validation",
      "A percentage must be supplied for each participant.",
      { field: "percents" },
    );
  }

  let percentSum = 0;
  for (const pct of percents) {
    if (!Number.isInteger(pct) || pct < 0) {
      return err<Split[]>(
        "validation",
        "Each percentage must be a non-negative integer.",
        { field: "percents" },
      );
    }
    percentSum += pct;
  }

  if (percentSum !== 100) {
    return err<Split[]>(
      "validation",
      "Percentages must sum to exactly 100.",
      { field: "percents" },
    );
  }

  // Integer floor share and fractional remainder per member. `amountMinor *
  // pct` is formed before the division so no floating-point value is produced.
  // `percents[index]` is guaranteed present (lengths validated equal above);
  // the `?? 0` only satisfies `noUncheckedIndexedAccess` and is never taken.
  const shares = userIds.map((userId, index) => {
    const scaled = amountMinor * (percents[index] ?? 0);
    return {
      userId,
      shareMinor: Math.floor(scaled / 100),
      remainder: scaled % 100,
      index,
    };
  });

  const distributed = shares.reduce((sum, s) => sum + s.shareMinor, 0);
  let leftover = amountMinor - distributed; // 0 .. n-1 leftover minor units

  // Hand out leftover minor units to the largest fractional remainders first,
  // breaking ties by ascending participant index for determinism (Req 7.3).
  const order = [...shares].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (const entry of order) {
    if (leftover <= 0) {
      break;
    }
    entry.shareMinor += 1;
    leftover -= 1;
  }

  return ok(shares.map(({ userId, shareMinor }) => ({ userId, shareMinor })));
}

/**
 * Split an expense amount by **explicit per-member shares**, accepted only when
 * the supplied shares reconcile exactly to the amount (Req 7.5, 7.6).
 *
 * `shares` is positional, aligned to `userIds`: `shares[i]` is the minor-unit
 * portion assigned to `userIds[i]`. Unlike the equal and percent splits, this
 * function performs **no** redistribution — the caller has stated the exact
 * breakdown, so the calculator's job is purely to validate it and pass it
 * through unchanged. Because every share is supplied directly, INV-1 holds iff
 * `Σ shares === amountMinor`, which is exactly the acceptance condition.
 *
 * Rejected as a `validation` {@link Result} (nothing is produced, leaving the
 * ledger unchanged — Req 7.6):
 *   - `shares.length !== userIds.length` (a share per member is required),
 *     `field: "exactShares"`;
 *   - any share that is not a non-negative integer in minor units (Req 7.8),
 *     `field: "exactShares"`;
 *   - shares that do not sum to exactly `amountMinor`, `field: "exactShares"`.
 *
 * @param amountMinor - The expense amount, a positive integer in minor units
 *                      (INV-4). Range validation happens upstream.
 * @param userIds     - The ordered, non-empty list of members sharing the
 *                      expense (the empty set is rejected upstream, Req 7.7).
 * @param shares      - Per-member minor-unit shares, positional and aligned to
 *                      `userIds`, that must sum to exactly `amountMinor`.
 * @returns `ok(splits)` mirroring the supplied shares when they reconcile, or a
 *          `validation` {@link Result} when they do not.
 */
export function exactSplit(
  amountMinor: number,
  userIds: string[],
  shares: number[],
): Result<Split[]> {
  if (shares.length !== userIds.length) {
    return err<Split[]>(
      "validation",
      "An exact share must be supplied for each participant.",
      { field: "exactShares" },
    );
  }

  let total = 0;
  for (const share of shares) {
    if (!Number.isInteger(share) || share < 0) {
      return err<Split[]>(
        "validation",
        "Each exact share must be a non-negative integer in minor units.",
        { field: "exactShares" },
      );
    }
    total += share;
  }

  if (total !== amountMinor) {
    return err<Split[]>(
      "validation",
      "Exact shares must sum to the expense amount.",
      { field: "exactShares" },
    );
  }

  return ok(
    // `shares[index]` is guaranteed present (lengths validated equal above);
    // the `?? 0` only satisfies `noUncheckedIndexedAccess` and is never taken.
    userIds.map((userId, index) => ({
      userId,
      shareMinor: shares[index] ?? 0,
    })),
  );
}

/**
 * The Split_Calculator surface (design: Components and Interfaces —
 * Split_Calculator). Groups the split algorithms behind one object so the
 * orchestration layer can depend on a single value.
 */
export const SplitCalculator = {
  /** Equal split with deterministic remainder distribution (Req 7.1, 7.2). */
  equalSplit,
  /** Percentage split with deterministic drift distribution (Req 7.3, 7.4). */
  percentSplit,
  /** Exact split accepted only when shares reconcile (Req 7.5, 7.6). */
  exactSplit,
} as const;
