import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { contentSecurityPolicy } from "./csp";

// Adds the Content Security Policy to index.html in the production build only.
function securityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        "</head>",
        `    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />\n  </head>`,
      ),
  };
}

export default defineConfig({
  plugins: [react(), securityPolicy()],
  server: {
    port: 5173,
    // `npm run dev` outside Docker: forward API calls to the backend on :8000
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "csp.test.ts"], // browser tests live in e2e/ (Playwright)
  },
});
