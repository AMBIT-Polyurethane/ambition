import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import type { LinkRow } from "@/lib/types";

export const metadata = { title: "Form" };

// Shows a form or page (e.g. a Jotform) inside the app.
export default async function GoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  const { data } = await supabase.from("links").select("*").eq("id", id).maybeSingle<LinkRow>();
  if (!data?.url || !/^https?:\/\//.test(data.url)) notFound();

  // Jotform fills fields whose unique name matches a URL parameter, so pass who is signed in.
  const u = new URL(data.url);
  if (/jotform/i.test(u.hostname)) {
    if (profile.full_name && !u.searchParams.has("name")) u.searchParams.set("name", profile.full_name);
    if (!u.searchParams.has("email")) u.searchParams.set("email", profile.email);
  }

  return (
    <main className="shell wide" style={{ gap: 12 }}>
      <TopBar
        title={data.title}
        back="/"
        right={
          <a className="iconbtn" href={u.toString()} target="_blank" rel="noopener noreferrer" aria-label="Open in browser">
            <ExternalLink size={18} />
          </a>
        }
      />
      <iframe className="frame" src={u.toString()} title={data.title} allow="geolocation; camera; microphone; fullscreen" />
    </main>
  );
}
