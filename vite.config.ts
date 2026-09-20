import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Netlify, Vercel and Cloudflare Pages serve from the domain root; GitHub Pages serves from
// /<repo>/, so the Pages workflow builds with BASE_PATH set. Everything in the app derives its
// links from import.meta.env.BASE_URL, which Vite fills in from this.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "motion-vendor": ["framer-motion"],
          "ui-vendor": ["@heroui/react", "@heroui/styles"],
          "icons-vendor": ["lucide-react"],
        },
      },
    },
  },
  // `host: true` is what lets a phone on the same network open the dev server, which is the only
  // way to try the show on two real devices. `strictPort` is for the native shell: `tauri dev`
  // waits on the fixed `devUrl` in `src-tauri/tauri.conf.json`, so a Vite that quietly moved to
  // 5174 because something else held 5173 would leave the window on a blank page with no error.
  server: { host: true, allowedHosts: true, port: 5173, strictPort: true },
  // The script parser works on real DOM nodes, so its tests need a DOM. happy-dom is dev-only.
  test: { environment: "happy-dom" },
});
