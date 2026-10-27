import { requireActive } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { AppsEditor } from "@/components/apps-editor";
import { FOLDERS, arrangeApps, parseLayout } from "@/lib/home-apps";
import { homeApps } from "@/lib/home-apps-server";

export const metadata = { title: "Edit your apps" };
export const dynamic = "force-dynamic";

export default async function EditAppsPage() {
  const { supabase, profile } = await requireActive();
  const apps = arrangeApps(await homeApps(supabase, profile), parseLayout(profile.home_apps), true);
  return (
    <main className="shell">
      <TopBar title="Your apps" back="/" />
      <p className="muted small" style={{ margin: 0 }}>
        Move apps up or down to change their spot on your home screen, and switch off any you don&apos;t use. Your layout follows you to
        every phone and computer. Apps marked with a folder name sit inside that folder on your home screen.
      </p>
      <AppsEditor apps={apps.map((a) => ({ key: a.key, label: a.label, icon: a.icon, color: a.color, hidden: a.hidden, folder: a.folder ? FOLDERS[a.folder].label : null }))} />
    </main>
  );
}
