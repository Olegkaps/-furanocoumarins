import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vite.dev/config/
export default defineConfig({
  // Ketcher's ESM bundle still requires Raphael in its browser renderer.
  build: { commonjsOptions: { transformMixedEsModules: true } },
  plugins: [
    react(),
    nodePolyfills({ include: ["events", "buffer", "process", "util"] }),
  ],
});
