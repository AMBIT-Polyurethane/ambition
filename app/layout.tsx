import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Archivo (SIL Open Font License), self-hosted so the build never depends on Google Fonts.
const archivo = localFont({
  src: "./fonts/archivo-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-archivo",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

export const metadata: Metadata = {
  title: { default: "AMBITION", template: "%s · AMBITION" },
  description: "Ordering, product docs and training from AMBIT Polyurethane.",
  applicationName: "AMBITION",
  appleWebApp: { capable: true, title: "AMBITION", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
