/**
 * Balance_Engine — derives every member's net position and the pairwise
 * "who owes whom" from an append-only ledger (INV-2).
 *
 * The central design principle of LedgerLoop is that **balance is an output,
 * not state**: expenses, expense splits, and settlements are immutable inserts,
 * and a member's position is always *derived* by summing the ledger on the read
 * path (Req 9.1, 9.2). This module is the pure, in-memory realisation of that
 * derivation. It never reads or writes a stored balance; it is a pure function
 * of the {@link LedgerSnapshot} it is handed.
 *
 * Two derivations live here:
 *
 *   - {@link deriveNetPositions} — each member's signed net position in minor
 *     units, using the architecture's **corrected** sign convention
 *     (`+paid − owed + settled_out − settled_in`). A flipped settlement sign is
 *     a documented critical pitfall: INV-2 (sum-to-zero) holds for *either*
 *     sign, so only an explicit direction check (added by the property suite,
 *     task 4.4) catches a flip. The sign is fixed here, once, correctly.
 *   - {@link derivePairwiseDebts} — a canonical, simplified "who owes whom"
 *     transfer set. This is what the settle-up pre-fill renders and what
 *     `Settlement_Validator.maxSettleable` reads to cap a settlement at what the
 *     payer actually owes the receiver (INV-5).
 *
 * ## Single accounting unit (currency) — derivation scope
 *
 * Each expense and settlement in the snapshot carries an ISO-4217 `currency`,
 * but the derivation here **sums minor units directly** within the group's
 * single accounting unit, exactly as the design's balance-derivation SQL does
 * (it sums `amount_minor`/`share_minor` without converting). For the MVP the
 * snapshot's amounts are understood to be in the group's accounting unit;
 * presenting a position in a viewer's preferred currency is a separate,
 * read-time concern owned by `Currency_Display` (task 7, Req 14), which never
 * mutates these stored amounts. The `currency` fields are therefore retained on
 * the snapshot for provenance and downstream display but are not consulted by
 * the arithmetic below.
 *
 * ## Integer-only money discipline (INV-4)
 *
 * Every amount is an integer count of minor units (see `types.ts`). The
 * derivation uses only integer addition, subtraction, and `Math.min`, so no
 * floating-point value can ever arise. Amounts at this layer are safe-integer
 * `number`s (the `bigint` boundary lives in persistence); summing validated
 * group-scale ledgers stays within `Number.MAX_SAFE_INTEGER`.
 */

import type { Transfer } from "./types";

/**
 * A single expense row as the Balance_Engine consumes it.
 *
 * @property id          - The expense's application-generated identifier.
 * @property paidBy       - The member who paid the expense; their net position
 *                          moves **up** by `amountMinor` (the `+paid` term).
 * @property amountMinor  - The expense total, a positive integer in minor units
 *                          (INV-4). By INV-1 this equals the sum of the
 *                          expense's split shares.
 * @property currency     - The expense's ISO-4217 currency code. Retained for
 *                          provenance/display; not used by the derivation,
 *                          which works in the group's single accounting unit.
 */
export interface SnapshotExpense {
  id: string;
  paidBy: string;
  amountMinor: number;
  currency: string;
}

/**
 * A single expense-split row: one participant's share of one expense.
 *
 * @property expenseId   - The expense this share belongs to (joins to
 *                         {@link SnapshotExpense.id}).
 * @property userId      - The member who owes this share; their net position
 *                         moves **down** by `shareMinor` (the `−owed` term).
 * @property shareMinor  - The owed portion, a non-negative integer in minor
 *                         units (Req 7.8). Across an expense's splits these sum
 *                         exactly to the expense amount (INV-1).
 */
export interface SnapshotSplit {
  expenseId: string;
  userId: string;
  shareMinor: number;
}

/**
 * A single settlement row: a payment one member made to another to reduce a
 * debt.
 *
 * @property fromUser     - The payer; their net position moves **up** by
 *                          `amountMinor` toward zero (the `+settled_out` term).
 * @property toUser       - The receiver; their net position moves **down** by
 *                          `amountMinor` toward zero (the `−settled_in` term).
 * @property amountMinor  - The settled amount, a positive integer in minor
 *                          units (INV-4).
 * @property currency     - The settlement's ISO-4217 currency code. Retained
 *                          for provenance/display; not used by the derivation.
 */
export interface SnapshotSettlement {
  fromUser: string;
  toUser: string;
  amountMinor: number;
  currency: string;
}

/**
 * An immutable read-model of one group's ledger, sufficient to derive every
 * balance. This is the in-memory shape the Balance_Engine consumes and the
 * shape `Persistence.loadLedger` produces (design: Persistence).
 *
 * Derivation is a pure function of this snapshot — there is no stored balance
 * to read (Req 9.1). A snapshot with no expenses and no settlements derives a
 * net position of zero for every listed member (Req 9.7).
 *
 * @property members      - The group's member ids. Every member appears in the
 *                          derived net-position map, even with an empty ledger,
 *                          so absent activity reads as a derived zero (Req 9.7).
 * @property expenses     - The group's expenses (append-only).
 * @property splits       - The expense-split shares; each references an expense
 *                          via {@link SnapshotSplit.expenseId}.
 * @property settlements  - The group's settlements (append-only).
 */
export interface LedgerSnapshot {
  members: string[];
  expenses: SnapshotExpense[];
  splits: SnapshotSplit[];
  settlements: SnapshotSettlement[];
}

/**
 * Add `delta` (a signed integer in minor units) to `id`'s running net position,
 * creating the entry at zero on first contact. Centralising the accumulation
 * keeps the four sign terms below symmetric and guarantees every contribution
 * is folded in (which is what makes the sum-to-zero invariant exact).
 */
function addTo(net: Map<string, number>, id: string, delta: number): void {
  net.set(id, (net.get(id) ?? 0) + delta);
}

/**
 * Derive each member's signed **net position** in the group from the
 * append-only ledger, in minor units (Req 9.1, 9.2).
 *
 * The sign convention is the architecture's corrected one:
 *
 * ```
 * net(member) =  Σ amount_minor of expenses the member PAID        (+paid)
 *              − Σ share_minor  of the member's splits             (−owed)
 *              + Σ amount_minor of settlements the member SENT      (+settled_out)
 *              − Σ amount_minor of settlements the member RECEIVED  (−settled_in)
 * ```
 *
 * A **positive** net position means the member is a *creditor* (is owed money);
 * a **negative** net position means the member is a *debtor* (owes money).
 * Recording a settlement of `A` from payer `P` to receiver `R` therefore moves
 * `P`'s net **up** by `A` and `R`'s net **down** by `A`, both toward zero
 * (Req 9.4) — the direction that a flipped sign would invert.
 *
 * Properties guaranteed by construction (integer arithmetic only, INV-4):
 *
 * - **Empty-ledger zero (Req 9.7).** Every id in `snapshot.members` is seeded
 *   to `0`, so a group with no expenses and no settlements derives `0` for
 *   every member.
 * - **Sum-to-zero (INV-2, Req 9.3).** Each expense contributes `+amount` to its
 *   payer and `−Σ shares` across its splits; because the splits sum to the
 *   amount (INV-1), an expense nets to `0` across all members. Each settlement
 *   contributes `+A` and `−A`, also netting to `0`. Hence the integer sum over
 *   the whole map is exactly `0`. (Every ledger contribution is folded in via
 *   {@link addTo}, so the invariant cannot be broken by a row that references an
 *   id outside `members`; in a referentially valid snapshot — INV-6 — every
 *   referenced id is already a member and the map has exactly one entry per
 *   member.)
 * - **Derived, never stored (Req 9.1).** The result depends only on the
 *   snapshot's rows; no balance is read from or written to anywhere.
 *
 * @param snapshot - The group's ledger read-model.
 * @returns A map from member id to net position (integer minor units). Positive
 *          = creditor, negative = debtor; the values sum to exactly zero.
 */
export function deriveNetPositions(
  snapshot: LedgerSnapshot,
): Map<string, number> {
  const net = new Map<string, number>();

  // Seed every member at zero so an empty ledger derives zero for all (Req 9.7)
  // and members with no activity still appear in the result.
  for (const memberId of snapshot.members) {
    if (!net.has(memberId)) {
      net.set(memberId, 0);
    }
  }

  // +paid: the payer's position rises by the full expense amount.
  for (const expense of snapshot.expenses) {
    addTo(net, expense.paidBy, expense.amountMinor);
  }

  // −owed: each member's position falls by the shares they owe.
  for (const split of snapshot.splits) {
    addTo(net, split.userId, -split.shareMinor);
  }

  // +settled_out / −settled_in: paying moves the payer up, the receiver down.
  for (const settlement of snapshot.settlements) {
    addTo(net, settlement.fromUser, settlement.amountMinor);
    addTo(net, settlement.toUser, -settlement.amountMinor);
  }

  return net;
}

/** A debtor or creditor bucket while reducing net positions to transfers. */
interface Party {
  id: string;
  /** Remaining magnitude in minor units: amount owed (debtor) / owed-to (creditor). */
  amount: number;
}

/**
 * Order parties by descending magnitude, breaking ties by ascending id so the
 * reduction is fully deterministic for identical ledgers (a stable, canonical
 * pairwise debt set is what settle-up pre-fill and `maxSettleable` rely on).
 */
function byAmountDescThenId(a: Party, b: Party): number {
  if (a.amount !== b.amount) {
    return b.amount - a.amount;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Derive the group's **pairwise debts** — a canonical "who owes whom" transfer
 * set — from the same ledger derivation as {@link deriveNetPositions}.
 *
 * ## Chosen semantics: greedy minimum-cashflow reduction
 *
 * The net positions are reduced to concrete payer→receiver transfers by the
 * greedy min-cashflow method: repeatedly settle the largest debtor against the
 * largest creditor for the smaller of their two magnitudes, until no member
 * holds a non-zero position. This yields a *simplified* pairwise debt set
 * rather than the raw expense-by-expense tangle, which is exactly what the
 * design specifies the settlement cap to read: `maxSettleable` is "the pairwise
 * amount the payer currently owes the receiver, computed from the group's
 * simplified pairwise debt derived from the ledger." A consumer computing
 * `maxSettleable(from, to)` looks up the transfer whose `from`/`to` match and
 * takes its `amountMinor` (treating an absent pair as `0`).
 *
 * Guarantees (all from the greedy construction over the zero-sum net map, using
 * integer arithmetic only):
 *
 * - **Reconciliation.** For every member, (received − sent) across the returned
 *   transfers equals that member's net position; the plan fully discharges the
 *   derived balances.
 * - **Canonical & deterministic.** Debtors and creditors are processed largest
 *   first with id-order tie-breaking, so identical ledgers always produce an
 *   identical transfer list.
 * - **Well-formed transfers.** Each {@link Transfer} is a strictly positive
 *   integer minor-unit amount from a payer to a *distinct* receiver (a member's
 *   net is either a debit or a credit, never both, so `from !== to`).
 * - **Empty when settled.** When every net position is zero — including the
 *   empty ledger (Req 9.7) — there are no debtors or creditors and the result
 *   is an empty array.
 *
 * This is a pure, read-path function: no locks, no writes, no stored balance.
 *
 * @param snapshot - The group's ledger read-model.
 * @returns The simplified pairwise debts as a list of payer→receiver transfers.
 */
export function derivePairwiseDebts(snapshot: LedgerSnapshot): Transfer[] {
  const net = deriveNetPositions(snapshot);

  const debtors: Party[] = [];
  const creditors: Party[] = [];
  for (const [id, value] of net) {
    if (value < 0) {
      debtors.push({ id, amount: -value });
    } else if (value > 0) {
      creditors.push({ id, amount: value });
    }
  }

  debtors.sort(byAmountDescThenId);
  creditors.sort(byAmountDescThenId);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    // The defensive guards keep the loop well-typed under
    // noUncheckedIndexedAccess; the bounds checks above ensure both exist.
    if (debtor === undefined || creditor === undefined) {
      break;
    }

    const amountMinor = Math.min(debtor.amount, creditor.amount);
    if (amountMinor > 0) {
      transfers.push({ from: debtor.id, to: creditor.id, amountMinor });
    }

    debtor.amount -= amountMinor;
    creditor.amount -= amountMinor;
    if (debtor.amount === 0) {
      i += 1;
    }
    if (creditor.amount === 0) {
      j += 1;
    }
  }

  return transfers;
}

/**
 * The Balance_Engine surface (design: Components and Interfaces —
 * Balance_Engine). Groups the pure derivations behind one object so the
 * orchestration layer can depend on a single value, mirroring the
 * `SplitCalculator` shape.
 *
 * Both members are pure functions of the {@link LedgerSnapshot}; neither reads
 * nor writes a stored balance (Req 9.1).
 */
export const BalanceEngine = {
  /** Per-member signed net position in minor units (Req 9.2, INV-2). */
  deriveNetPositions,
  /** Canonical simplified pairwise debts for settle-up / INV-5 cap. */
  derivePairwiseDebts,
} as const;
