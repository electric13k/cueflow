import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Netlify, Vercel and Cloudflare Pages serve from the domain root; GitHub Pages serves from
// /<repo>/, so the Pages workflow builds with BASE_PATH set. Everything in the app derives its
// links from import.meta.env.BASE_URL, which Vite fills in from this.
export default defineConfig({ base: process.env.BASE_PATH || "/", plugins: [react()] });
