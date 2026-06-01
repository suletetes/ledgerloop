/**
 * Debt_Simplifier — greedy min-cashflow transfer planning (Req 10).
 *
 * Given a group's derived net positions, the Debt_Simplifier produces a
 * {@link Transfer} plan that settles everyone up in the *fewest* payments. It is
 * a **pure function of the net map**: it reads no ledger, takes no locks, and
 * writes nothing, so it runs safely on the read path (Req 10.6). All arithmetic
 * is integer minor-units arithmetic (INV-4); no floating point participates.
 *
 * The algorithm is the greedy min-cashflow scheme from the architecture (§6):
 * repeatedly settle the **largest debtor** against the **largest creditor**,
 * transferring the smaller of the two outstanding magnitudes, then advance past
 * whichever party reaches zero. Each iteration zeroes out at least one party, so
 * the plan contains at most one fewer transfer than the number of members with a
 * non-zero net position (Req 10.3, proven by task 5.3) and reconciles every
 * member's position exactly (Req 10.2, proven by task 5.2) by construction plus
 * INV-2 (group net positions sum to zero).
 */

import type { Transfer } from "./types";

/**
 * One party (creditor or debtor) in the simplification, carrying a member id
 * and the *positive* outstanding magnitude still to be matched. Debtors store
 * the absolute value of their (negative) net position, so both lists are sorted
 * and compared as positive integers.
 */
interface Party {
  id: string;
  /** Outstanding magnitude in minor units; strictly positive while unmatched. */
  amt: number;
}

/**
 * Compute a minimum-payment {@link Transfer} plan from a group's derived net
 * positions, using the greedy min-cashflow algorithm (Req 10.1, architecture §6).
 *
 * The `net` map associates each member with their net position in minor units,
 * using the Balance_Engine sign convention: **positive = creditor** (is owed
 * money), **negative = debtor** (owes money), zero = settled. The function
 * partitions members into creditors and debtors, sorts each by descending
 * magnitude, then repeatedly matches the largest remaining debtor against the
 * largest remaining creditor — transferring `min(debt, credit)` minor units and
 * advancing past whichever side hits zero — until one side is exhausted.
 *
 * Guarantees (by construction; the universal properties are proven in tasks
 * 5.2/5.3):
 *
 * - **Positive-integer transfers to a distinct receiver (Req 10.7).** Each
 *   `amountMinor` is `min(debt, credit)` where both magnitudes are strictly
 *   positive at the moment of the transfer, so it is a positive integer. A
 *   member is either a creditor or a debtor (never both), so `from` and `to`
 *   are always distinct members.
 * - **Empty plan when settled (Req 10.4).** If every net position is zero (or
 *   the map is empty), there are no creditors and no debtors, so the loop never
 *   runs and the plan is empty.
 * - **Read-path purity (Req 10.6).** The result depends only on `net`; the
 *   input map is not mutated, and there is no I/O, locking, or persistence.
 * - **Worst case `n − 1` transfers** for `n` members with a non-zero position,
 *   since each iteration zeroes at least one of the two matched parties.
 *
 * Integer-only discipline (INV-4): every magnitude originates as an integer
 * minor-unit net position, and the only operations are comparison, `Math.min`,
 * and subtraction, so no intermediate is ever a float.
 *
 * @param net - Per-member net positions in minor units (positive = creditor,
 *              negative = debtor). Not mutated. A well-formed group satisfies
 *              INV-2 (the values sum to zero), which is what lets the plan
 *              reconcile exactly; this function does not itself require or
 *              enforce that and simply applies the greedy match to whatever it
 *              is given.
 * @returns The simplified plan: zero or more positive-integer transfers, each
 *          from a paying member to a distinct receiving member.
 */
export function simplifyDebts(net: Map<string, number>): Transfer[] {
  // Partition into creditors (net > 0) and debtors (net < 0). Debtor magnitudes
  // are stored as positive values (the absolute net) so both lists compare as
  // positive integers. Members with a zero net position are simply omitted,
  // which yields the empty plan when every position is zero (Req 10.4).
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  for (const [id, value] of net) {
    if (value > 0) {
      creditors.push({ id, amt: value });
    } else if (value < 0) {
      debtors.push({ id, amt: -value });
    }
  }

  // Largest magnitude first. Array.sort is stable, so members with equal
  // magnitude keep their original map-iteration order, making the plan a
  // deterministic function of the input map.
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0; // index of the current largest debtor
  let j = 0; // index of the current largest creditor

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    // The loop bounds guarantee both are present; this narrowing satisfies
    // `noUncheckedIndexedAccess` without a non-null assertion and is never hit.
    if (debtor === undefined || creditor === undefined) {
      break;
    }

    // Settle as much as possible between this debtor/creditor pair. Both
    // magnitudes are strictly positive here, so `pay` is a positive integer
    // (Req 10.7); `from` (a debtor) and `to` (a creditor) are distinct members.
    const pay = Math.min(debtor.amt, creditor.amt);
    transfers.push({ from: debtor.id, to: creditor.id, amountMinor: pay });

    debtor.amt -= pay;
    creditor.amt -= pay;

    // Advance past whichever party is now fully settled. When `pay` exhausts
    // both at once, both indices advance, which is what keeps the transfer
    // count at most (n - 1).
    if (debtor.amt === 0) {
      i += 1;
    }
    if (creditor.amt === 0) {
      j += 1;
    }
  }

  return transfers;
}

/**
 * The Debt_Simplifier surface (design: Components and Interfaces —
 * Debt_Simplifier). Groups the simplification entry point behind one object so
 * the orchestration layer can depend on a single value, mirroring the
 * {@link import("./split-calculator").SplitCalculator} shape.
 */
export const DebtSimplifier = {
  /** Greedy min-cashflow simplification of derived net positions (Req 10.1). */
  simplifyDebts,
} as const;
