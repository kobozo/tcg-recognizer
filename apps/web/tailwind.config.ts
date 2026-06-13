import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0B1220",
        surface: "#0F1B2A",
        elevated: "#16233A",
        border: "rgba(148, 163, 184, 0.14)",
        foreground: "#F1F5F9",
        muted: "#94A3B8",
        primary: {
          DEFAULT: "#16A34A",
          hover: "#15803D",
          fg: "#FFFFFF",
        },
        accent: {
          DEFAULT: "#F59E0B",
          hover: "#D97706",
          fg: "#1C1206",
        },
        destructive: {
          DEFAULT: "#EF4444",
          fg: "#FFFFFF",
        },
        ring: "#22C55E",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,197,94,0.25), 0 8px 30px -8px rgba(34,197,94,0.35)",
        "glow-accent":
          "0 0 0 1px rgba(245,158,11,0.25), 0 8px 30px -8px rgba(245,158,11,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 40px -12px rgba(0,0,0,0.6)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        scanline: "scanline 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
