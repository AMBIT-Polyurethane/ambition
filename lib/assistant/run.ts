import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KINDS, NO_SOURCE_MARK, modelInfo, type AiSettings, type AiSource } from "@/lib/assistant/config";
import { systemPrompt } from "@/lib/assistant/policy";
import type { Profile } from "@/lib/types";

// One answer from Ask AMBIT: search AMBIT's approved knowledge, let Claude search more (and, if it's on,
// look things up on the approved websites only), stream the words as they come, then return the answer
// with numbered sources. Citation markers in the saved answer look like ⟦1,2⟧.

type Msg = Anthropic.Messages.MessageParam;
type Block = Anthropic.Messages.ContentBlock;
type SearchBlock = Anthropic.Messages.SearchResultBlockParam;

export type Emit = (event: Record<string, unknown>) => void;

type Hit = {
  chunk_id: number;
  source_id: string;
  kind: string;
  origin: string;
  title: string;
  page: number | null;
  body: string;
  document_id: string | null;
};

type Ref = { title: string; kind: string; href: string; page: number | null; site?: string | null };

export type HistoryRow = { role: "user" | "assistant" | "expert"; body: string; author_name?: string | null };

export type Answer = {
  body: string;
  sources: AiSource[];
  noSource: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  costCents: number;
};

const KIND_IDS = KINDS.map((k) => k.id);

function hrefFor(h: Hit): string {
  const page = h.page ? `#page=${h.page}` : "";
  if (h.document_id) return `/docs/open/${h.document_id}${page}`;
  return `/assistant/source/${h.source_id}${h.origin === "upload" ? page : ""}`;
}

async function search(supabase: SupabaseClient, q: string, kinds: string[] | null, refs: Map<string, Ref>, max = 8): Promise<SearchBlock[]> {
  const { data, error } = await supabase.rpc("ai_search", { q: q.slice(0, 400), kinds: kinds && kinds.length ? kinds : null, max_rows: max });
  if (error) throw new Error(`Knowledge search failed: ${error.message}`);
  return ((data ?? []) as Hit[]).map((h) => {
    const key = `ambit:${h.source_id}:${h.page ?? 0}`;
    if (!refs.has(key)) refs.set(key, { title: h.title, kind: h.kind, href: hrefFor(h), page: h.page });
    const kind = KINDS.find((k) => k.id === h.kind)?.short ?? h.kind;
    return {
      type: "search_result",
      source: key,
      title: `${h.title}${h.page ? `, page ${h.page}` : ""} [${kind}]`,
      content: [{ type: "text", text: h.body }],
      citations: { enabled: true },
    };
  });
}

/** Earlier turns of the conversation, as plain text, alternating user / assistant. */
function historyMessages(rows: HistoryRow[]): Msg[] {
  const out: Msg[] = [];
  for (const r of rows.slice(-14)) {
    const role = r.role === "user" ? "user" : "assistant";
    let text = r.body.replace(/⟦[\d,\s]+⟧/g, "").trim();
    if (r.role === "expert") text = `Answer from AMBIT's expert${r.author_name ? ` (${r.author_name})` : ""}:\n${text}`;
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role, content: text.slice(0, 6000) });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // An unanswered question at the end (an earlier error) is dropped; the new one replaces it.
  while (out.length && out[out.length - 1].role !== "assistant") out.pop();
  return out;
}

function friendlyError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const msg = String((e as { message?: string })?.message ?? e);
  if (status === 401 || /authentication|api[_ -]?key/i.test(msg)) return "Ask AMBIT's connection to Claude isn't working (an admin needs to check ANTHROPIC_API_KEY in Vercel).";
  if (/credit balance|billing/i.test(msg)) return "Ask AMBIT is out of credit. An admin needs to add credit in the Anthropic Console (Billing).";
  if (status === 429 || status === 529 || /overloaded|rate limit/i.test(msg)) return "Ask AMBIT is busy right now. Try again in a minute.";
  if (status === 404 || /not_found_error|model.*(not found|does not exist)/i.test(msg)) return "The AI model picked in Admin → Ask AMBIT isn't available. Pick another model there.";
  return "Something went wrong while answering. Try again in a moment.";
}

export async function runAnswer(opts: {
  supabase: SupabaseClient;
  profile: Profile;
  settings: AiSettings;
  history: HistoryRow[];
  question: string;
  emit: Emit;
}): Promise<Answer> {
  const { supabase, profile, settings, question, emit } = opts;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 100_000 });
  const model = modelInfo(settings.model);
  let webOn = settings.web_lookups && settings.allowed_sites.length > 0;
  const { rules, who } = systemPrompt(profile, settings, webOn);
  const refs = new Map<string, Ref>();

  // Look first with the question itself (and the previous answered question, for short follow-ups).
  const hist = historyMessages(opts.history);
  const prevUser = String([...hist].reverse().find((h) => h.role === "user")?.content ?? "").slice(0, 300);
  const firstQuery = question.length < 80 && prevUser ? `${question} ${prevUser}` : question;
  emit({ t: "status", text: "Searching AMBIT knowledge…" });
  const first = await search(supabase, firstQuery, null, refs, 8);

  const searchTool: Anthropic.Messages.Tool = {
    name: "search_knowledge",
    description:
      "Search AMBIT's approved knowledge base: AMBIT teaching (Jeremiah Bryant's TSBs and notes), AMBIT product documents (TDS, SDS, ESR/CCRR, application guides, warranties), building code (IECC/IRC/IBC), HVAC (ACCA/ASHRAE) and neutral science references, and notes about using the app. Use specific words: product names, TSB numbers, parts of the building, code sections.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
        kinds: { type: "array", items: { type: "string", enum: KIND_IDS }, description: "Optional: only these kinds of knowledge" },
      },
      required: ["query"],
    },
  };
  const toolsFor = (web: boolean): Anthropic.Messages.ToolUnion[] =>
    web
      ? [searchTool, { type: "web_search_20250305", name: "web_search", max_uses: 3, allowed_domains: settings.allowed_sites }]
      : [searchTool];
  let tools = toolsFor(webOn);
  const system = (web: boolean): Anthropic.Messages.TextBlockParam[] => {
    const r = web === webOn ? rules : systemPrompt(profile, settings, web).rules;
    return [
      { type: "text", text: r, cache_control: { type: "ephemeral" } },
      { type: "text", text: who },
    ];
  };

  let messages: Msg[] = [
    ...hist,
    { role: "user", content: [...first, { type: "text", text: question }] },
  ];

  const kept: { blocks: Block[]; final: boolean }[] = [];
  let inputTokens = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let outputTokens = 0;
  let webSearches = 0;
  let retriedWithoutWeb = false;

  for (let round = 0; round < 8; round++) {
    let msg: Anthropic.Messages.Message;
    try {
      const stream = client.messages.stream({ model: model.id, max_tokens: 2048, system: system(webOn), tools, messages });
      let wrote = false;
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          if (ev.content_block.type === "server_tool_use") emit({ t: "status", text: "Checking approved websites…" });
          else if (ev.content_block.type === "tool_use") emit({ t: "status", text: "Searching AMBIT knowledge…" });
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          if (!wrote) emit({ t: "status", text: "" });
          wrote = true;
          emit({ t: "delta", text: ev.delta.text });
        }
      }
      msg = await stream.finalMessage();
    } catch (e) {
      const text = String((e as { message?: string })?.message ?? "");
      if (webOn && !retriedWithoutWeb && /web[_ ]?search/i.test(text)) {
        // Web search is turned off for this Anthropic organization: carry on without it.
        retriedWithoutWeb = true;
        webOn = false;
        tools = toolsFor(false);
        round--;
        continue;
      }
      throw Object.assign(new Error(friendlyError(e)), { cause: e });
    }

    const u = msg.usage;
    inputTokens += u.input_tokens ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    outputTokens += u.output_tokens ?? 0;
    webSearches += u.server_tool_use?.web_search_requests ?? 0;

    const done = msg.stop_reason !== "tool_use" && msg.stop_reason !== "pause_turn";
    kept.push({ blocks: msg.content, final: done });

    if (msg.stop_reason === "tool_use") {
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const b of msg.content) {
        if (b.type !== "tool_use") continue;
        if (b.name !== "search_knowledge") {
          results.push({ type: "tool_result", tool_use_id: b.id, content: "Unknown tool.", is_error: true });
          continue;
        }
        const input = (b.input ?? {}) as { query?: string; kinds?: string[] };
        const kinds = Array.isArray(input.kinds) ? input.kinds.filter((k) => KIND_IDS.includes(k as never)) : null;
        const found = await search(supabase, String(input.query ?? question), kinds, refs, 8);
        results.push({
          type: "tool_result",
          tool_use_id: b.id,
          content: found.length ? found : [{ type: "text", text: "No results found in AMBIT's approved knowledge." }],
        });
      }
      messages = [...messages, { role: "assistant", content: msg.content }, { role: "user", content: results }];
      continue;
    }
    if (msg.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: msg.content }];
      continue;
    }
    break;
  }

  // Put the answer together: text with ⟦n⟧ after the words each source backs, sources numbered in order.
  const sources: AiSource[] = [];
  const numberFor = (key: string, make: () => Omit<AiSource, "n">): number => {
    const found = sources.find((s) => (s as AiSource & { key?: string }).key === key);
    if (found) return found.n;
    const s = { ...make(), n: sources.length + 1, key } as AiSource & { key: string };
    sources.push(s);
    return s.n;
  };
  let body = "";
  for (const round of kept) {
    const texts = round.blocks.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    const roundText = texts.map((t) => t.text).join("");
    // Words written before a search ("let me check…") aren't part of the answer.
    if (!round.final && roundText.trim().length < 300 && !texts.some((t) => t.citations?.length)) continue;
    for (const t of texts) {
      const nums: number[] = [];
      for (const c of t.citations ?? []) {
        let n: number | null = null;
        if (c.type === "search_result_location") {
          const ref = refs.get(c.source);
          n = numberFor(c.source, () => ({
            title: ref?.title ?? c.title ?? "AMBIT source",
            kind: ref?.kind ?? "teaching",
            href: ref?.href ?? "/docs",
            page: ref?.page ?? null,
            quote: c.cited_text?.slice(0, 280) ?? null,
          }));
        } else if (c.type === "web_search_result_location") {
          let site: string | null = null;
          try {
            site = new URL(c.url).hostname.replace(/^www\./, "");
          } catch {}
          n = numberFor(c.url, () => ({ title: c.title || site || c.url, kind: "web", href: c.url, page: null, site, quote: c.cited_text?.slice(0, 280) ?? null }));
        }
        if (n && !nums.includes(n)) nums.push(n);
      }
      body += t.text;
      if (nums.length) {
        // Put the marker before trailing spaces / line breaks so it sits right after the words.
        const m = /\s*$/.exec(body);
        const tail = m ? m[0] : "";
        body = body.slice(0, body.length - tail.length) + `⟦${nums.join(",")}⟧` + tail;
      }
    }
    if (!round.final) body += "\n\n";
  }
  const noSource = body.includes(NO_SOURCE_MARK);
  body = body.split(NO_SOURCE_MARK).join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) body = "I couldn't put an answer together for that. Try asking it a different way.";

  const costCents =
    (((inputTokens + cacheWrite * 1.25 + cacheRead * 0.1) * model.inPerM + outputTokens * model.outPerM) / 1_000_000) * 100 + webSearches * 1;

  return {
    body,
    sources: sources.map(({ n, title, kind, href, page, site, quote }) => ({ n, title, kind, href, page: page ?? null, site: site ?? null, quote: quote ?? null })),
    noSource,
    model: model.id,
    inputTokens: inputTokens + cacheWrite + cacheRead,
    outputTokens,
    searches: webSearches,
    costCents: Math.round(costCents * 1000) / 1000,
  };
}
