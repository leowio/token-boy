import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "http://localhost:3000",
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
});
