import type { Kpis } from "@/lib/ops/kpis";

// The daily briefing AMBIT Intelligence gives on the first visit of the day: the few things that need
// the owner or office today, most urgent first, each one tappable. Also read out loud on request.

export type BriefIcon = "chem" | "trips" | "tasks" | "review" | "follow" | "quote" | "yield" | "unsched" | "clear";
export type BriefItem = { icon: BriefIcon; tone: "bad" | "warn" | "ok" | "info"; text: string; href: string; go: string };
export type Brief = { hello: string; lead: string; items: BriefItem[]; speech: string };

type Task = { id: string; body: string; due_on: string | null; lead_id: string | null; customer_id: string | null };

const n = (v: number, one: string, many = `${one}s`) => `${v} ${v === 1 ? one : many}`;
const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const drums = (v: number) => (Math.round(v * 10) / 10).toString();

export function dailyBrief({ k, tasks, first, today, hello }: { k: Kpis | null; tasks: Task[]; first: string; today: string; hello: string }): Brief {
  const items: BriefItem[] = [];
  const dayName = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

  if (k) {
    const c = k.chem;
    const short = [
      { name: "Closed cell resin", have: c.cc, need: c.cc_need },
      { name: "Open cell resin", have: c.oc, need: c.oc_need },
      { name: "ISO", have: c.iso, need: c.oc_need + c.cc_need },
    ].filter((x) => x.need > 0 && x.have < x.need);
    if (short.length) {
      const x = short[0];
      items.push({
        icon: "chem",
        tone: "bad",
        text: `${x.name} is short: ${drums(x.have)} drums on hand, ${drums(x.need)} needed for the next two weeks.${short.length > 1 ? ` ${short.slice(1).map((y) => y.name.replace(" resin", "")).join(" and ")} ${short.length > 2 ? "are" : "is"} short too.` : ""}`,
        href: "/order",
        go: "Order from AMBIT",
      });
    }
    const trips = k.today_trips ?? [];
    const crews = new Set(trips.map((t) => t.rig ?? t.id)).size;
    items.push(
      trips.length
        ? { icon: "trips", tone: "info", text: `${n(crews, "crew")} ${crews === 1 ? "is" : "are"} out on ${n(trips.length, "job")} today.`, href: "/ops/schedule", go: "Schedule" }
        : { icon: "trips", tone: "info", text: "No crews are on the schedule today.", href: "/ops/schedule", go: "Schedule" },
    );
  }

  const dueTasks = tasks.filter((t) => t.due_on && t.due_on <= today);
  if (dueTasks.length) {
    const t = dueTasks[0];
    items.push({
      icon: "tasks",
      tone: "warn",
      text: `${dueTasks.length === 1 ? "A reminder is due" : `${dueTasks.length} reminders are due`}: ${t.body.length > 70 ? `${t.body.slice(0, 68)}…` : t.body}`,
      href: t.lead_id ? `/ops/leads/${t.lead_id}` : t.customer_id ? `/ops/customers/${t.customer_id}` : "/ops#tasks",
      go: "Open",
    });
  }

  if (k) {
    if (k.work_orders.review) {
      items.push({ icon: "review", tone: "warn", text: `${n(k.work_orders.review, "finished work order")} ${k.work_orders.review === 1 ? "is" : "are"} waiting for your review.`, href: "/ops/work-orders", go: "Review" });
    }
    if (k.pipeline.due) {
      items.push({ icon: "follow", tone: "warn", text: `${n(k.pipeline.due, "lead")} ${k.pipeline.due === 1 ? "is" : "are"} due for a follow-up.`, href: "/ops/pipeline", go: "Leads" });
    }
    const hot = k.attention.hot_quotes?.[0];
    if (hot) {
      items.push({ icon: "quote", tone: "ok", text: `${hot.customer} has opened quote #${hot.number} ${n(hot.views, "time")} (${money(hot.total)}). Good time to call.`, href: `/ops/quotes/${hot.id}`, go: "Quote" });
    }
    const low = k.attention.low_yield?.[0];
    if (low) {
      items.push({ icon: "yield", tone: "bad", text: `Job #${low.job_no} (${low.customer}) sprayed ${low.kind === "foam_cc" ? "closed" : "open"} cell at ${Math.round(low.pct)}% of target yield.`, href: `/ops/jobs/${low.job_id}`, go: "Job" });
    }
    if (k.backlog.unscheduled) {
      items.push({ icon: "unsched", tone: "info", text: `${n(k.backlog.unscheduled, "sold job")} still ${k.backlog.unscheduled === 1 ? "needs" : "need"} a date.`, href: "/ops/schedule", go: "Schedule" });
    }
  }

  const top = items.slice(0, 6);
  if (!top.some((x) => x.tone === "bad" || x.tone === "warn")) {
    top.push({ icon: "clear", tone: "ok", text: "Nothing is overdue. Nice work.", href: "/ops", go: "Home" });
  }
  const lead = top.some((x) => x.tone === "bad" || x.tone === "warn") ? `Here's what needs you this ${dayName}:` : `Here's your ${dayName}:`;
  const speech = [`${hello}, ${first}.`, lead.replace(/:$/, "."), ...top.map((x) => x.text)].join(" ");
  return { hello: `${hello}, ${first}.`, lead, items: top, speech };
}

/** What the guide says when it pops up for setup (the screen shows the same words). */
export function setupLine(first: string, brand: string, steps: { done: boolean; label: string }[]): string {
  const left = steps.filter((x) => !x.done);
  const done = steps.length - left.length;
  if (!left.length) return `You're all set up, ${first}. ${brand} is ready to run on AMBIT-OPS.`;
  if (done === 0)
    return `Hey ${first}, I'm AMBIT Intelligence. Let's get ${brand} running in AMBIT-OPS. It's ${left.length} quick steps, about 15 minutes. Tap Show me and I'll take you to each one and tell you exactly what to do.`;
  return `Welcome back, ${first}. ${done} of ${steps.length} setup steps are done. Next up: ${left[0].label.toLowerCase()}. Tap Show me and I'll walk you through it.`;
}
