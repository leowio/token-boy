import { resolve } from "node:path";

import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl =
    env.VITE_BACKEND_URL || env.VITE_API_URL || "http://localhost:4210";

  return {
    base: "./",
    plugins: [basicSsl()],
    server: {
      proxy: {
        "/api": backendUrl,
        "/socket.io": {
          target: env.VITE_SOCKET_URL || backendUrl,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          stat: resolve(process.cwd(), "index.html"),
          data: resolve(process.cwd(), "data.html"),
          dataDetail: resolve(process.cwd(), "data-detail.html"),
          map: resolve(process.cwd(), "map.html"),
          camera: resolve(process.cwd(), "camera.html"),
        },
      },
    },
  };
});
