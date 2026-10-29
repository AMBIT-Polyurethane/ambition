import { CircleAlert, CircleCheck } from "lucide-react";
import { TopBar } from "@/components/ui";

/** Every OPS settings page: title, back to Settings, and the saved / problem banner. */
export function SettingsShell({ title, sp, children, wide }: { title: string; sp: Record<string, string | undefined>; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className={`shell${wide ? " wide" : ""}`}>
      <TopBar title={title} back="/ops/settings" />
      {sp.msg ? <div className="alert ok" role="status"><CircleCheck size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.msg}</span></div> : null}
      {sp.err ? <div className="alert err" role="alert"><CircleAlert size={18} style={{ flex: "none", marginTop: 1 }} /><span>{sp.err}</span></div> : null}
      {children}
    </main>
  );
}
