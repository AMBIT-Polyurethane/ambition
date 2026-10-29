import { requireOps } from "@/lib/ops/server";
import { opsCan } from "@/lib/ops/roles";
import { LABOR_METHODS, MEASURE_UNITS } from "@/lib/ops/defaults";
import { SettingsShell } from "@/components/ops/settings-shell";
import { Submit } from "@/components/forms";
import { savePricing } from "../actions";

export const metadata = { title: "Pricing, margins and labor" };
export const dynamic = "force-dynamic";

const v = (n: number | null) => (n === null || n === undefined ? "" : String(n));

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { ws } = await requireOps(opsCan.manage);
  const s = ws.settings;
  return (
    <SettingsShell title="Pricing, margins and labor" sp={sp} wide>
      <form action={savePricing} className="col" style={{ gap: 14 }}>
        <section className="card col" style={{ gap: 12 }}>
          <b>Margins</b>
          <span className="tiny faint">Bids use direct margin: materials, labor and direct consumables only, no overhead. Quotes are priced to your target; anything under the lowest margin needs an owner to approve it.</span>
          <div className="grid3">
            <label className="field">
              <span className="label">Target margin %</span>
              <input className="input" name="target_margin" inputMode="decimal" defaultValue={v(s.target_margin)} placeholder="e.g. 45" />
            </label>
            <label className="field">
              <span className="label">Builder target margin %</span>
              <input className="input" name="builder_margin" inputMode="decimal" defaultValue={v(s.builder_margin)} placeholder="Blank = same as target" />
            </label>
            <label className="field">
              <span className="label">Lowest margin %</span>
              <input className="input" name="floor_margin" inputMode="decimal" defaultValue={v(s.floor_margin)} placeholder="e.g. 30" />
            </label>
            <label className="field">
              <span className="label">Labor burden %</span>
              <input className="input" name="burden_pct" inputMode="decimal" defaultValue={v(s.burden_pct)} placeholder="Payroll taxes, comp, insurance" />
            </label>
          </div>
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <b>Labor rates</b>
          <span className="tiny faint">What you pay crews for each kind of work. BIBS pays mesh and blowing separately. Leave a rate blank if you don&apos;t do that work.</span>
          <div className="ops-labor">
            <div className="ops-labor-row head" aria-hidden="true"><span>Work</span><span>Paid</span><span>Rate</span></div>
            {s.labor.map((l) => (
              <div key={l.key} className="ops-labor-row">
                <input type="hidden" name="labor_key" value={l.key} />
                <input className="input sm" name="labor_name" defaultValue={l.name} maxLength={60} aria-label="Work" />
                <select className="select sm" name="labor_method" defaultValue={l.method} aria-label={`How ${l.name} is paid`}>
                  {LABOR_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <span className="price-in">
                  <span aria-hidden="true">$</span>
                  <input className="input sm" name="labor_rate" inputMode="decimal" defaultValue={v(l.rate)} placeholder="–" aria-label={`Rate for ${l.name}`} />
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card col" style={{ gap: 12 }}>
          <b>Quotes</b>
          <div className="grid3">
            <label className="field">
              <span className="label">Default waste %</span>
              <input className="input" name="waste_pct" inputMode="decimal" defaultValue={v(s.waste_pct)} />
            </label>
            <label className="field">
              <span className="label">Quote good for (days)</span>
              <input className="input" name="quote_days" inputMode="numeric" defaultValue={v(s.quote_days)} />
            </label>
            <label className="field">
              <span className="label">Follow up after (days)</span>
              <input className="input" name="followup_days" defaultValue={s.followup_days.join(", ")} placeholder="2, 5, 10" />
            </label>
            <label className="field">
              <span className="label">Deposit at signing %</span>
              <input className="input" name="deposit_pct" inputMode="decimal" defaultValue={v(s.deposit_pct)} placeholder="None" />
            </label>
            <label className="field">
              <span className="label">Minimum job $</span>
              <input className="input" name="min_job" inputMode="decimal" defaultValue={v(s.min_job)} placeholder="None" />
            </label>
            <label className="field">
              <span className="label">Sales tax %</span>
              <input className="input" name="tax_rate" inputMode="decimal" defaultValue={v(s.tax_rate)} placeholder="None" />
            </label>
          </div>
          <label className="check"><input type="checkbox" name="tax_labor" defaultChecked={s.tax_labor} /> Charge tax on labor too (not just materials)</label>
          <label className="check"><input type="checkbox" name="show_line_prices" defaultChecked={s.show_line_prices} /> Show a price on every line of the proposal (otherwise just the option totals)</label>
        </section>

        <section className="card col" style={{ gap: 10 }}>
          <b>How your crews measure foam used</b>
          <div className="col" style={{ gap: 8 }}>
            {MEASURE_UNITS.map((m) => (
              <label key={m.key} className="check">
                <input type="radio" name="measure_unit" value={m.key} defaultChecked={s.measure_unit === m.key} />
                <span><b>{m.label}</b> <span className="tiny faint">{m.hint}</span></span>
              </label>
            ))}
          </div>
        </section>
        <Submit className="btn" pendingText="Saving…">Save pricing and labor</Submit>
      </form>
    </SettingsShell>
  );
}
