import { heroui } from "@heroui/react";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
      },
      boxShadow: { glass: "0 8px 32px -8px rgba(2,6,23,.6), inset 0 1px 0 rgba(255,255,255,.06)" },
      keyframes: { float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } } },
      animation: { float: "float 6s ease-in-out infinite" },
    },
  },
  darkMode: "class",
  plugins: [heroui({
    themes: {
      dark: {
        colors: {
          primary: { DEFAULT: "#22d3ee", foreground: "#04121a" },
          secondary: { DEFAULT: "#a78bfa", foreground: "#160b2e" },
          background: "#050914",
          focus: "#22d3ee",
        },
      },
    },
  })],
};
