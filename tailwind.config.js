import { heroui } from "@heroui/react";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  darkMode: "class",
  plugins: [heroui({ themes: { dark: { colors: { primary: { DEFAULT: "#22d3ee", foreground: "#04121a" }, background: "#050914", focus: "#22d3ee" } } } })],
};
