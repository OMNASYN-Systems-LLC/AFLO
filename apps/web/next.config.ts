import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@aflo/shared",
    "@aflo/rules",
    "@aflo/ai",
    "@aflo/auth",
    "@aflo/notifications",
    "@aflo/academy",
    "@aflo/partner-marketplace",
  ],
};

export default nextConfig;
