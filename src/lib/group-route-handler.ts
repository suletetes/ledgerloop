/**
 * Group-scoped route handler helper (Task 15.3).
 *
 * Wires session authentication + Auth_Guard membership enforcement into every
 * group-scoped route handler / server action. Ensures:
 *
 * 1. The caller is authenticated (session cookie → userId)
 * 2. The caller is a member of the target group (Auth_Guard check)
 * 3. All financial mutations route through the API to the Ledger Service
 *    (browser never touches Persistence directly — Req 19.6)
 *
 * Requirements:
 * - 5.1: Every group-scoped read/write is gated by Auth_Guard
 * - 19.6: All financial mutations route through the API to the Ledger Service
 */

import { requireAuth, type RouteGuardResult } from "./route-guard";
import { AuthGuard } from "@/ledger/auth-guard";
import type { Persistence } from "@/ledger/persistence";
import type { Result } from "@/domain/result";
import { mapDomainErrorToResponse, type ApiErrorResponse } from "./api-response";

export interface GroupRouteContext {
  /** The authenticated caller's member id. */
  callerId: string;
  /** The target group id (from the route params). */
  groupId: string;
}

export interface GroupRouteSuccess {
  ok: true;
  context: GroupRouteContext;
}

export interface GroupRouteFailure {
  ok: false;
  /** HTTP status code */
  status: number;
  /** Response body */
  body: ApiErrorResponse | { error: { category: string; message: string } };
}

export type GroupRouteResult = GroupRouteSuccess | GroupRouteFailure;

/**
 * Resolve the caller's member id and verify group membership before any
 * group-scoped read or write proceeds.
 *
 * @param cookieHeader - The raw Cookie header from the request
 * @param groupId - The target group id from route params
 * @param persistence - The Persistence instance for Auth_Guard checks
 * @returns GroupRouteSuccess with context, or GroupRouteFailure with status/body
 */
export async function resolveGroupRoute(
  cookieHeader: string | undefined | null,
  groupId: string,
  persistence: Persistence,
): Promise<GroupRouteResult> {
  // Step 1: Authenticate the session
  const authResult: RouteGuardResult = requireAuth(cookieHeader);
  if (!authResult.authenticated) {
    return {
      ok: false,
      status: 401,
      body: { error: { category: "authentication", message: "Authentication required" } },
    };
  }

  // Step 2: Check group membership via Auth_Guard
  const guard = new AuthGuard(persistence);
  const membershipResult: Result<void> = await guard.requireGroupMembership(
    authResult.userId,
    groupId,
  );

  if (!membershipResult.ok) {
    const mapped = mapDomainErrorToResponse(membershipResult.error);
    return {
      ok: false,
      status: mapped.status,
      body: mapped.body,
    };
  }

  return {
    ok: true,
    context: {
      callerId: authResult.userId,
      groupId,
    },
  };
}
