import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    base: "./",
    server: {
      port: 3000,
      allowedHosts: true,
      proxy: {
        "/bridge": {
          target: `http://127.0.0.1:${env.PRIME_BRIDGE_PORT ?? "3117"}`,
          changeOrigin: true,
        },
        // The NIM key lives server-side only; the renderer never sees it.
        // Aimed at the bridge rather than at NVIDIA directly: the bridge is
        // where every NIM request — the daemon's included — is counted, and a
        // request that skipped it would be missing from the usage readout.
        "/api/nim": {
          target: `http://127.0.0.1:${env.PRIME_BRIDGE_PORT ?? "3117"}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/nim/, "/nim/v1"),
          headers: { Authorization: `Bearer ${env.NIM_API_KEY ?? ""}` },
        },
        // Vercel AI Gateway, same shape and the same reason: server-side only.
        // No Authorization is attached here — unlike NIM, the bridge is the
        // single place the gateway key lives, so the browser cannot send one
        // and this config cannot leak one into a build log.
        "/api/gw": {
          target: `http://127.0.0.1:${env.PRIME_BRIDGE_PORT ?? "3117"}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/gw/, "/gw/v1"),
        },
      },
    },
    define: {
      __NIM_MODEL__: JSON.stringify(env.NIM_MODEL ?? "deepseek-ai/deepseek-v4-pro-0813"),
    },
  };
});
