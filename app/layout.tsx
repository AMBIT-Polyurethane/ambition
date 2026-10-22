import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getTheme } from "@/lib/theme-server";
import { THEME_COLOR } from "@/lib/theme";
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

export async function generateMetadata(): Promise<Metadata> {
  const theme = await getTheme();
  return {
    title: { default: "AMBITION", template: "%s · AMBITION" },
    description: "Ordering, product docs and training from AMBIT Polyurethane.",
    applicationName: "AMBITION",
    // Dark mode draws under the iPhone status bar; light and auto use the standard bar so its text stays readable.
    appleWebApp: { capable: true, title: "AMBITION", statusBarStyle: theme === "dark" ? "black-translucent" : "default" },
    formatDetection: { telephone: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return {
    themeColor:
      theme === "light"
        ? THEME_COLOR.light
        : theme === "system"
          ? [
              { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
              { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
            ]
          : THEME_COLOR.dark,
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  return (
    <html lang="en" className={archivo.variable} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
