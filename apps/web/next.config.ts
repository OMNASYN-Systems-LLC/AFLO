import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@aflo/shared",
    "@aflo/rules",
    "@aflo/ai",
    "@aflo/auth",
    "@aflo/notifications",
    "@aflo/academy",
  ],
};

export default nextConfig;
