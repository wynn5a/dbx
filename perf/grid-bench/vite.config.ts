import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dirname,
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      // Block every Tauri call at the single funnel point instead of stubbing
      // @/lib/api (which re-exports hundreds of names).
      { find: /^@tauri-apps\/api\/core$/, replacement: path.resolve(dirname, "tauri-core-stub.ts") },
      { find: "@", replacement: path.resolve(dirname, "../../apps/desktop/src") },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    minify: false,
  },
});
