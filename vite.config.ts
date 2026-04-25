import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        stat: resolve(process.cwd(), "index.html"),
        data: resolve(process.cwd(), "data.html"),
        map: resolve(process.cwd(), "map.html"),
      },
    },
  },
});
