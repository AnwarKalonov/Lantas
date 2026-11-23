import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not be confused by the Rust watcher.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Monaco ships hundreds of ESM modules and its own CSS. Naming it here makes
  // Vite pre-bundle it once at startup; discovering it lazily instead triggers
  // a mid-load re-optimise and 503s on its CSS, which leaves the editor blank.
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari15",
    sourcemap: false,
  },
});
