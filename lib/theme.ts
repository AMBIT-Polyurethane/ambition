// Light / dark appearance. Saved per device in the "theme" cookie (Profile > Appearance).
export type Theme = "dark" | "light" | "system";

export const THEME_COOKIE = "theme";

export function parseTheme(v: string | null | undefined): Theme {
  return v === "light" || v === "system" ? v : "dark";
}

export const THEME_COLOR = { dark: "#0A0A0B", light: "#f4f4f6" } as const;
