import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static files, images and the app manifest/icons.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|brand/|icons/|templates/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|csv)$).*)",
  ],
};
