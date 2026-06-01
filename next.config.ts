import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Req 19.2: type-checking is enforced in the build. These flags are kept
  // explicitly false so a type or lint error fails `next build` rather than
  // silently shipping. Do not set either of these to `true`.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
