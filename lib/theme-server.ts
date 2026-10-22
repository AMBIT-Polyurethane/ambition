import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type Theme } from "@/lib/theme";

export async function getTheme(): Promise<Theme> {
  try {
    return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  } catch {
    return "dark";
  }
}
