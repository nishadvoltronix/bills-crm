import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The only linked package is the compiled browser-safe public contracts.
  turbopack: { root: resolve(__dirname, "..") },
  transpilePackages: ["@voltronix/crm-contracts"],
  serverExternalPackages: ["mysql2", "pdfkit"],
  outputFileTracingIncludes: {
    "/api/quotations/*/pdf": ["./assets/quotation-pdf/**/*", "./node_modules/pdfkit/js/data/**/*"],
  },
  // Runtime data and credentials are provisioned separately, never packaged as code.
  outputFileTracingExcludes: {
    "/*": ["./.local-data/**/*", "./.private/**/*", "./.env*", "../backend/**/*",
      "../.local-dev/**/*", "../.private-legacy/**/*", "../nextjs/**/*", "../tools/**/*",
      "../application/**/*", "../system/**/*", "../vendor/**/*", "../include/**/*"],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default config;
