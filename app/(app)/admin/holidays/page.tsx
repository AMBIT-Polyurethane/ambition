import { requireAdmin } from "@/lib/session";
import { TopBar } from "@/components/ui";
import { Submit } from "@/components/forms";
import { holidaySettings } from "@/lib/holidays-server";
import { closedDays, holidaysFor } from "@/lib/holidays";
import { todayCentral } from "@/lib/sale";
import { addClosedDay, removeClosedDay, saveHolidays } from "./actions";

export const metadata = { title: "Holidays" };

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Admin: the days AMBIT is closed (order dates warn on them; Home shows them two weeks ahead) and the holiday touches. */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const s = await holidaySettings(supabase);
  const y = Number(todayCentral().slice(0, 4));
  const list = holidaysFor(y).filter((h) => h.closable);
  const closedThis = closedDays(y, s);
  const closedNext = closedDays(y + 1, s);
  return (
    <main className="shell">
      <TopBar title="Holidays" back="/admin" />
      {sp.msg ? <div className="alert ok small" role="status">{sp.msg}</div> : null}
      {sp.err ? <div className="alert err small" role="alert">{sp.err}</div> : null}
      <form action={saveHolidays} className="col" style={{ gap: 16 }}>
        <section className="card col" style={{ gap: 10 }}>
          <label className="check"><input type="checkbox" name="touches" defaultChecked={s.touches} /> <b>Holiday touches</b></label>
          <span className="tiny muted">
            Around Thanksgiving, Christmas, New Year&apos;s, the Fourth of July, Halloween and Valentine&apos;s Day, Home shows a seasonal card with a greeting
            and, once a day, a few seconds of falling leaves, snow or confetti. Closed days show on Home two weeks ahead.
          </span>
        </section>
        <section className="section">
          <div className="eyebrow">Closed (every year)</div>
          <div className="list">
            {list.map((h) => (
              <label key={h.key} className="item" style={{ cursor: "pointer" }}>
                <input type="checkbox" name="closed" value={h.key} defaultChecked={s.closed.includes(h.key)} />
                <span className="grow col" style={{ gap: 1 }}>
                  <span className="t">{h.name}</span>
                  <span className="s">{day(h.date)}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="tiny muted">A closed holiday on a Saturday is taken Friday; on a Sunday, Monday. Order &ldquo;Needed by&rdquo; and scheduling dates warn when AMBIT is closed.</span>
        </section>
        <div><Submit className="btn">Save</Submit></div>
      </form>
      <section className="section">
        <div className="eyebrow">Other days AMBIT is closed</div>
        <div className="list">
          {s.extra.length ? s.extra.map((e) => (
            <form key={e.date} action={removeClosedDay} className="item">
              <input type="hidden" name="date" value={e.date} />
              <span className="grow col" style={{ gap: 1 }}><span className="t">{e.name}</span><span className="s">{day(e.date)}</span></span>
              <Submit className="btn sm dark">Remove</Submit>
            </form>
          )) : <div className="item"><span className="small muted">None. Add inventory days, company events or weather closures.</span></div>}
        </div>
        <form action={addClosedDay} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input sm" type="date" name="date" required aria-label="Day" />
          <input className="input sm grow" name="name" placeholder="Why (Inventory count, Company picnic…)" aria-label="Why" />
          <Submit className="btn sm">Add</Submit>
        </form>
      </section>
      <section className="section">
        <div className="eyebrow">Closed days</div>
        <div className="card small" style={{ lineHeight: 1.7 }}>
          <b>{y}:</b> {closedThis.map((c) => `${day(c.date)} (${c.name})`).join(" · ") || "none"}
          <br />
          <b>{y + 1}:</b> {closedNext.map((c) => `${day(c.date)} (${c.name})`).join(" · ") || "none"}
        </div>
      </section>
    </main>
  );
}
