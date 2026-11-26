import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the page works at a domain root or a subpath.
  base: "./",
  server: { port: 5180 },
  build: { target: "es2020" },
});
