import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // Which version this is (the GitHub commit on Vercel). Open apps compare it with /api/version
  // when they come back on screen, so phones pick up new versions on their own.
  env: { APP_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || `local-${Date.now()}` },
  // The order PDF is drawn with @react-pdf/renderer, which runs as a normal Node package (not bundled).
  serverExternalPackages: ["@react-pdf/renderer"],
  // pdfkit (inside react-pdf) loads its built-in fonts by a path Vercel's file tracing can't see, so ship them with
  // every server route (PDF downloads, and emails that attach a PDF).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pdfkit/js/standard-fonts/**", "./node_modules/pdfkit/js/data/**"],
  },
  // The opening animation files rarely change; let phones keep them for a week.
  async headers() {
    return [{ source: "/splash/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] }];
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
