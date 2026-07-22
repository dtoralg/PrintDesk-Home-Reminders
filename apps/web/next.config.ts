import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@printdesk/shared-models"],
};

export default nextConfig;
