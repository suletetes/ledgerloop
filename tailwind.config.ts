import type { Config } from "tailwindcss";
import { colors, radii, spacing, typography } from "./src/design/tokens";

/**
 * Tailwind configuration wired to the shared design tokens (Req 19.3).
 * Color, typography, and spacing all derive from `src/design/tokens.ts` so the
 * design system has a single source of truth.
 */

// Tokens are frozen with `as const` (readonly tuples); clone the fontSize
// entries into mutable [size, { lineHeight }] tuples that Tailwind's type accepts.
const fontSize: Record<string, [string, { lineHeight: string }]> =
  Object.fromEntries(
    Object.entries(typography.fontSize).map(([key, [size, options]]) => [
      key,
      [size, { ...options }],
    ]),
  );

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: colors.brand,
        neutral: colors.neutral,
        creditor: colors.creditor,
        debtor: colors.debtor,
        success: colors.success,
        warning: colors.warning,
        danger: colors.danger,
        info: colors.info,
      },
      fontFamily: {
        sans: [...typography.fontFamily.sans],
        mono: [...typography.fontFamily.mono],
      },
      fontSize,
      fontWeight: typography.fontWeight,
      spacing,
      borderRadius: radii,
    },
  },
  plugins: [],
};

export default config;
