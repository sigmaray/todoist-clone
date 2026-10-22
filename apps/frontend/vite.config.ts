import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://127.0.0.1:3000",
      "/projects": "http://127.0.0.1:3000",
      "/sections": "http://127.0.0.1:3000",
      "/settings": {
        target: "http://127.0.0.1:3000",
        bypass: (request) => request.headers.accept?.includes("text/html") ? request.url : undefined
      },
      "/tasks": "http://127.0.0.1:3000",
      "/tools-api": "http://127.0.0.1:3000"
    }
  }
});
