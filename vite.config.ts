import { defineConfig } from "vite";

// Relative base so the build works from any subpath (GitHub Pages, Cloudflare, etc.).
// allowedHosts lets you open the dev server from a phone over Tailscale/LAN.
export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 1000 },
  server: { allowedHosts: true },
  preview: { allowedHosts: true },
});
