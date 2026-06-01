/**
 * Shared design tokens (Req 19.3).
 *
 * Single source of truth for color, typography, and spacing. These tokens are
 * consumed by `tailwind.config.ts` so the design system is shared across the
 * whole UI rather than scattered in ad-hoc class values. Keep this file
 * framework-agnostic (plain data) so tokens can also be referenced at runtime.
 *
 * Color choices target WCAG 2.1 AA contrast (Req 17) — e.g. creditor/debtor
 * semantic colors are paired with non-color indicators in the UI layer.
 */

export const colors = {
  // Brand / primary scale
  brand: {
    50: "#eef4ff",
    100: "#d9e6ff",
    200: "#bcd2ff",
    300: "#8eb4ff",
    400: "#598bff",
    500: "#2f64f0",
    600: "#1f4bd1",
    700: "#1b3ca8",
    800: "#1b3585",
    900: "#1b2f69",
  },
  // Neutral / surface scale
  neutral: {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
  },
  // Semantic ledger colors. Always paired with a text/symbol indicator in the
  // UI so status never relies on color alone (Req 9.5, 17.5).
  creditor: "#15803d", // owed money (positive net position)
  debtor: "#b91c1c", // owes money (negative net position)
  // Feedback
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
  info: "#1f4bd1",
} as const;

export const typography = {
  fontFamily: {
    sans: [
      "var(--font-sans)",
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      "Segoe UI",
      "Roboto",
      "Helvetica",
      "Arial",
      "sans-serif",
    ],
    mono: [
      "var(--font-mono)",
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Consolas",
      "monospace",
    ],
  },
  fontSize: {
    xs: ["0.75rem", { lineHeight: "1rem" }],
    sm: ["0.875rem", { lineHeight: "1.25rem" }],
    base: ["1rem", { lineHeight: "1.5rem" }],
    lg: ["1.125rem", { lineHeight: "1.75rem" }],
    xl: ["1.25rem", { lineHeight: "1.75rem" }],
    "2xl": ["1.5rem", { lineHeight: "2rem" }],
    "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

/**
 * Spacing scale (rem). Includes a `touch` step of 44px (2.75rem) to support the
 * minimum touch-target requirement (Req 18.2).
 */
export const spacing = {
  0: "0px",
  px: "1px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  touch: "2.75rem", // 44px minimum touch target (Req 18.2)
} as const;

export const radii = {
  none: "0px",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
} as const;

export const designTokens = {
  colors,
  typography,
  spacing,
  radii,
} as const;

export type DesignTokens = typeof designTokens;
