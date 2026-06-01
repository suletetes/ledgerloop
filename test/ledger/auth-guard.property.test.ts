/**
 * Property-based test for Auth_Guard group-scoped read guard.
 *
 * Validates: Requirements 5.1, 5.2
 */
import { describe, it } from "vitest";
import { fc, assertAsyncProperty } from "../helpers/property";
import { membershipGraph } from "../helpers/generators";
import { AuthGuard, InMemoryPersistence } from "@/ledger";

// Feature: ledgerloop-app, Property 8: Group-scoped read guard without disclosure
describe("Property 8: Group-scoped read guard without disclosure", () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * Property 8: "For any group-scoped read request, the Auth_Guard allows it
   * if and only if the requesting member holds a membership in the target
   * group; a non-member request returns an authorization failure whose response
   * contains no group contents."
   */
  it("allows members, rejects non-members without disclosing group contents", async () => {
    await assertAsyncProperty(
      fc.asyncProperty(
        membershipGraph(),
        // Generate a non-existent group id to test not_found path
        fc.uuid(),
        async (graph, nonExistentGroupId) => {
          // Set up InMemoryPersistence with the generated graph
          const persistence = new InMemoryPersistence();

          // Insert all groups
          for (const group of graph.groups) {
            await persistence.insertGroup({
              id: group.id,
              name: `Group ${group.id.slice(0, 8)}`,
              baseCurrency: "USD",
              createdAt: new Date().toISOString(),
            });
          }

          // Insert all memberships
          for (const edge of graph.memberships) {
            await persistence.insertMembership({
              id: crypto.randomUUID(),
              groupId: edge.groupId,
              userId: edge.userId,
              joinedAt: new Date().toISOString(),
            });
          }

          const guard = new AuthGuard(persistence);

          // Build a set of membership pairs for quick lookup
          const membershipSet = new Set(
            graph.memberships.map((e) => `${e.groupId}:${e.userId}`),
          );

          // Collect all group names and ids for disclosure checks
          const groupNames = graph.groups.map((g) => `Group ${g.id.slice(0, 8)}`);
          const groupIds = graph.groups.map((g) => g.id);

          // Test every (member, group) combination
          for (const member of graph.members) {
            for (const group of graph.groups) {
              const result = await guard.requireGroupMembership(
                member.id,
                group.id,
              );

              const key = `${group.id}:${member.id}`;
              if (membershipSet.has(key)) {
                // Member IS a member of the group → should return ok
                if (!result.ok) {
                  throw new Error(
                    `Expected ok for member ${member.id} in group ${group.id}, got error: ${result.error.message}`,
                  );
                }
              } else {
                // Member is NOT a member of the group → should return authorization error
                if (result.ok) {
                  throw new Error(
                    `Expected authorization error for non-member ${member.id} in group ${group.id}, got ok`,
                  );
                }
                if (result.error.category !== "authorization") {
                  throw new Error(
                    `Expected category "authorization" for non-member, got "${result.error.category}"`,
                  );
                }
                // Req 5.2: error message must NOT contain any group contents
                const msg = result.error.message;
                for (const name of groupNames) {
                  if (msg.includes(name)) {
                    throw new Error(
                      `Authorization error message discloses group name "${name}": "${msg}"`,
                    );
                  }
                }
                for (const id of groupIds) {
                  if (msg.includes(id)) {
                    throw new Error(
                      `Authorization error message discloses group id "${id}": "${msg}"`,
                    );
                  }
                }
              }
            }
          }

          // Test non-existent group → should return not_found
          // Ensure the nonExistentGroupId is not one of the graph's groups
          const existingGroupIds = new Set(graph.groups.map((g) => g.id));
          if (!existingGroupIds.has(nonExistentGroupId) && graph.members.length > 0) {
            const caller = graph.members[0]!;
            const result = await guard.requireGroupMembership(
              caller.id,
              nonExistentGroupId,
            );

            if (result.ok) {
              throw new Error(
                `Expected not_found error for non-existent group ${nonExistentGroupId}, got ok`,
              );
            }
            if (result.error.category !== "not_found") {
              throw new Error(
                `Expected category "not_found" for non-existent group, got "${result.error.category}"`,
              );
            }
            // Disclosure check on not_found error message too
            const msg = result.error.message;
            for (const name of groupNames) {
              if (msg.includes(name)) {
                throw new Error(
                  `Not-found error message discloses group name "${name}": "${msg}"`,
                );
              }
            }
            for (const id of groupIds) {
              if (msg.includes(id)) {
                throw new Error(
                  `Not-found error message discloses group id "${id}": "${msg}"`,
                );
              }
            }
          }

          return true;
        },
      ),
    );
  });
});
