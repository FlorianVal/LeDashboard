import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ledashboard/",
  server: {
    proxy: {
      "/ledashboard/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/ledashboard/, ""),
      },
    },
  },
});
