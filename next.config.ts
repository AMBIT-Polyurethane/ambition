import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // The order PDF is drawn with @react-pdf/renderer, which runs as a normal Node package (not bundled).
  serverExternalPackages: ["@react-pdf/renderer"],
  // The opening animation files rarely change; let phones keep them for a week.
  async headers() {
    return [{ source: "/splash/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] }];
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
