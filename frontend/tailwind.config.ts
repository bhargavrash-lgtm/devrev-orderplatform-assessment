import type { Config } from "tailwindcss";

// Design tokens live here and only here. Components use these names, never raw hex values.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Replaces Tailwind's palette, so only these colours can be used.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#ffffff",
      black: "#0b0d12",
      page: "#f6f7f9", // soft grey page background
      ink: {
        DEFAULT: "#111827", // primary text
        muted: "#4b5563", // secondary text
        subtle: "#6b7280", // labels, help text
        faint: "#9ca3af", // placeholders, disabled
      },
      line: {
        DEFAULT: "#e5e7eb", // borders
        strong: "#d1d5db",
        soft: "#f0f1f4", // dividers inside cards
      },
      accent: {
        50: "#eef2ff",
        100: "#e0e7ff",
        200: "#c7d2fe",
        300: "#a5b4fc",
        500: "#6366f1",
        600: "#4f46e5", // the one accent
        700: "#4338ca",
        800: "#3730a3",
        900: "#312e81",
      },
      // Semantic tones, each a soft background, a readable text colour and a dot/border colour.
      neutral: { bg: "#f3f4f6", fg: "#374151", dot: "#9ca3af" },
      blue: { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
      amber: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
      violet: { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" },
      green: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
      red: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444", solid: "#dc2626", hover: "#b91c1c" },
    },
    fontFamily: {
      sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
    },
    // Type scale: small muted labels -> body -> section titles -> page titles.
    fontSize: {
      "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      xs: ["0.75rem", { lineHeight: "1.125rem" }],
      sm: ["0.875rem", { lineHeight: "1.375rem" }],
      base: ["0.9375rem", { lineHeight: "1.5rem" }],
      lg: ["1.0625rem", { lineHeight: "1.625rem", letterSpacing: "-0.005em" }],
      xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
      "2xl": ["1.625rem", { lineHeight: "2.125rem", letterSpacing: "-0.015em" }],
      "3xl": ["2.125rem", { lineHeight: "2.625rem", letterSpacing: "-0.02em" }],
    },
    borderRadius: {
      none: "0",
      sm: "6px",
      DEFAULT: "8px",
      md: "10px",
      card: "12px",
      lg: "16px",
      full: "9999px",
    },
    boxShadow: {
      none: "none",
      xs: "0 1px 2px rgba(16, 24, 40, 0.04)",
      card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.04)",
      raised: "0 4px 12px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.05)",
      overlay: "0 20px 48px rgba(16, 24, 40, 0.14), 0 4px 12px rgba(16, 24, 40, 0.06)",
      focus: "0 0 0 3px rgba(99, 102, 241, 0.35)",
    },
    extend: {
      spacing: {
        // Layout rhythm on top of Tailwind's 4px scale.
        gutter: "1.5rem",
        section: "2rem",
        page: "2.5rem",
        sidebar: "15.5rem",
        topbar: "4rem",
      },
      maxWidth: {
        content: "76rem",
        form: "24rem",
        prose: "40rem",
      },
      ringColor: {
        DEFAULT: "#6366f1",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-up": "slide-up 180ms ease-out",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
