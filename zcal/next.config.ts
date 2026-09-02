import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: keep it out of the bundler and let
  // Node require it at runtime.
  serverExternalPackages: ["better-sqlite3"],
  // This app is meant to be run privately on your own machine or your own
  // server. These headers keep it from being embedded or leaking referrers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
