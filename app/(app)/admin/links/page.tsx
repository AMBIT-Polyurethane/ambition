import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { Icon, ICON_NAMES } from "@/components/icons";
import { deleteLink, saveLink } from "@/app/(app)/admin/actions";
import type { LinkRow } from "@/lib/types";
import { PERMS } from "@/lib/access";

export const metadata = { title: "Links & forms" };

const AUD = { all: "Everyone", customer: "Contractors", employee: "AMBIT staff" } as const;

function LinkFields({ l }: { l?: LinkRow }) {
  return (
    <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
      <label className="field"><span className="label">Title</span><input className="input sm" name="title" defaultValue={l?.title ?? ""} required /></label>
      <label className="field" style={{ gridColumn: "span 2" }}><span className="label">Subtitle</span><input className="input sm" name="subtitle" defaultValue={l?.subtitle ?? ""} /></label>
      <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Link (Jotform, Google Drive, YouTube, website, mailto:, tel:)</span><input className="input sm" name="url" defaultValue={l?.url ?? ""} placeholder="https://ambit-polyurethane.jotform.com/…" /></label>
      <label className="field">
        <span className="label">Shows in</span>
        <select className="select sm" name="section" defaultValue={l?.section ?? "resources"}>
          <option value="forms">Forms list</option>
          <option value="resources">Resource tiles</option>
        </select>
      </label>
      <label className="field">
        <span className="label">Who sees it</span>
        <select className="select sm" name="audience" defaultValue={l?.audience ?? "all"}>
          {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">Icon</span>
        <select className="select sm" name="icon" defaultValue={l?.icon ?? "link"}>
          {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">AMBIT staff who see it</span>
        <select className="select sm" name="perm" defaultValue={l?.perm ?? ""}>
          <option value="">Everyone on the team</option>
          {PERMS.map((p) => <option key={p.key} value={p.key}>Only with: {p.label}</option>)}
        </select>
      </label>
      <label className="field"><span className="label">Sort</span><input className="input sm" name="sort" type="number" defaultValue={l?.sort ?? 0} /></label>
      <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" name="open_in_app" defaultChecked={l?.open_in_app ?? true} /> Open inside the app</label>
    </div>
  );
}

export default async function LinksAdminPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("links").select("*").order("section").order("sort").order("title");
  const links = (data ?? []) as LinkRow[];

  return (
    <main className="shell wide">
      <TopBar title="Home screen links & forms" back="/admin" />
      <p className="muted small" style={{ margin: 0 }}>
        Paste the link to each Jotform form (Publish → Copy link) or other page. Items with no link show as &ldquo;Coming soon&rdquo;.
        &ldquo;Open inside the app&rdquo; shows the page in AMBIT Intelligence and fills in the person&apos;s name and email on Jotform fields named <i>name</i> and <i>email</i>.
      </p>
      <details className="card">
        <summary><b>+ Add a link</b></summary>
        <form action={saveLink} className="col" style={{ marginTop: 14 }}>
          <LinkFields />
          <div><Submit className="btn sm">Add link</Submit></div>
        </form>
      </details>
      <div className="list">
        {links.map((l) => (
          <details key={l.id}>
            <summary className="item" style={{ minHeight: 56, opacity: l.active ? 1 : 0.5 }}>
              <div className="ic"><Icon name={l.icon} /></div>
              <div className="grow">
                <div className="t ellipsis">{l.title}</div>
                <div className="s ellipsis">{l.section === "forms" ? "Forms" : "Tiles"} · {AUD[l.audience]} · {l.url ? l.url : "no link yet"}</div>
              </div>
              <span className="small red">Edit</span>
            </summary>
            <div className="col" style={{ padding: "0 16px 16px" }}>
              <form action={saveLink} className="col">
                <input type="hidden" name="id" value={l.id} />
                <LinkFields l={l} />
                <div className="row">
                  <label className="check"><input type="checkbox" name="active" defaultChecked={l.active} /> Visible</label>
                  <Submit className="btn sm">Save</Submit>
                </div>
              </form>
              <form action={deleteLink}>
                <input type="hidden" name="id" value={l.id} />
                <button className="linkbtn" type="submit">Delete this link</button>
              </form>
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
