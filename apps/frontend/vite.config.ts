import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/tasks": "http://127.0.0.1:3000",
      "/tools-api": "http://127.0.0.1:3000"
    }
  }
});
