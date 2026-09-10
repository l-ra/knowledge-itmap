import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const kcTarget = env.KC_PROXY_TARGET || "http://localhost:8080";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@itmap/archimate-core": path.resolve(__dirname, "packages/archimate-core/src"),
      },
    },
    server: {
      port: 5174,
      proxy: {
        "/v1": {
          target: kcTarget,
          changeOrigin: true,
        },
        "/healthz": {
          target: kcTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
