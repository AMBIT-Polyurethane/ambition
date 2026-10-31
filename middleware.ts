import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static files, images, the app manifest/icons and the version check.
    // sw.js: the offline helper for crew work orders (must load without a sign-in redirect).
    "/((?!_next/static|_next/image|api/version|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|sw.js|brand/|icons/|splash/|templates/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|csv|mp4)$).*)",
  ],
};
