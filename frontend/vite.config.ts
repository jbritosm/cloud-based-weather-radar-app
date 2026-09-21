import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // `npm run dev` outside Docker: forward API calls to the backend on :8000
    proxy: { "/api": "http://localhost:8000" },
  },
});
