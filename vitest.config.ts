import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration for the LedgerLoop test harness (task 1.2).
 *
 * - `vite-tsconfig-paths` resolves the tsconfig path aliases (`@/*`,
 *   `@/domain/*`, `@/ledger/*`, `@/components/*`) so tests import domain code
 *   the same way application code does.
 * - The default environment is `node` because the bulk of the suite is
 *   pure-logic property-based testing (fast-check, ≥100 iterations) over the
 *   domain core. Accessibility tests added later (task 19) opt into a DOM by
 *   placing `// @vitest-environment jsdom` at the top of the file.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "test/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    // fast-check shrinking on a failing property can take longer than the
    // default per-test timeout; give properties room without being unbounded.
    testTimeout: 30_000,
  },
});
