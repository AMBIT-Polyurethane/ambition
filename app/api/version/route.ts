// Which version of the app is live right now. Open apps ask when they come back on screen and
// update themselves if theirs is older (components/splash.tsx). Nothing private: just a version tag.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { v: process.env.APP_BUILD ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
