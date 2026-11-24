import { requireAdmin } from "@/lib/session";
import { serviceClient, serviceReady } from "@/lib/supabase/service";
import { archiveCheck, type FormCheck } from "@/lib/jotform-archive";
import { archiveOnly } from "@/lib/jotform-store";
import { TopBar } from "@/components/ui";
import { ArchiveRunner } from "@/components/forms-archive";

export const metadata = { title: "Copy from Jotform" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admins: copy everything out of Jotform (0111) and check it, before Jotform is cancelled. */
export default async function JotformArchivePage() {
  await requireAdmin();
  let rows: FormCheck[] = [];
  let note = "";
  if (!serviceReady()) note = "SUPABASE_SECRET_KEY isn't set in Vercel, so the copy can't be saved.";
  else {
    try {
      rows = await archiveCheck(serviceClient(), false);
    } catch {
      note = "Run database update 0111 first (Supabase › SQL Editor).";
    }
  }
  return (
    <main className="shell">
      <TopBar title="Copy from Jotform" back="/admin/forms" />
      <p className="small muted" style={{ marginTop: 0 }}>
        Saves every Jotform form, every submission (all of its answers) and every attached file and signature into A.I. The Forms hub,
        credit applications, account setups, older price requests and receipt photos then keep working after Jotform is cancelled.
        Running it again only adds what&apos;s new.
      </p>
      {archiveOnly() ? <div className="alert ok small">Jotform is switched off (JOTFORM_ARCHIVE_ONLY): the app reads only this copy.</div> : null}
      {note ? <div className="alert warn small">{note}</div> : null}
      <ArchiveRunner initial={rows} hasKey={Boolean(process.env.JOTFORM_API_KEY?.trim()) && !archiveOnly()} />
    </main>
  );
}
