import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    // `server.entry: "server"` -> utilise src/server.ts (wrapper SSR d'erreurs) comme
    // entrée serveur TanStack Start ; nitro/vite construit à partir de cette entrée.
    tanstackStart({ server: { entry: "server" } }),
    nitro(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    allowedHosts: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
