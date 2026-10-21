import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/.well-known/ai-catalog.json", destination: "/api/ai-catalog" }];
  },
};

export default nextConfig;
