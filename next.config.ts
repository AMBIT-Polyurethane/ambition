import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // The order PDF is drawn with @react-pdf/renderer, which runs as a normal Node package (not bundled).
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
