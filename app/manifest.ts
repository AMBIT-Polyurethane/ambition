import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AMBIT Intelligence by AMBIT Polyurethane",
    short_name: "AMBIT A.I.",
    description: "Ordering, product docs and training from AMBIT Polyurethane.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
