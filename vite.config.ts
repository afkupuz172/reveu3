import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // All keys live server-side; the browser only ever talks to the API.
      "/api": "http://localhost:3001",
    },
  },
});
