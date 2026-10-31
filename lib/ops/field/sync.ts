"use client";

// AMBIT-OPS field app: sends what the phone saved (photos first, then the changes in order) and
// downloads the latest. Safe to run any time and as often as needed: every change carries its own id
// or full state, so a change sent twice (signal dropped before the answer came back) saves once.

import { createClient } from "@/lib/supabase/client";
import type { FieldStore } from "@/lib/ops/field/store";
import type { Bundle, Failed, Queued } from "@/lib/ops/field/types";

export type SyncResult = { ok: boolean; offline?: boolean; sent: number; failed: Failed[]; error?: string; bundle?: Bundle | null; signIn?: boolean };

const TRANSIENT = /didn't finish uploading|could not serialize|deadlock|timeout|temporarily|try again/i;
const MAX_TRIES = 25;

const isNetwork = (msg: string) => /fetch|network|load failed|offline|ECONN|abort/i.test(msg);
const isAuth = (msg: string, code?: string) => /jwt|token|not authenticated|sign in/i.test(msg) || code === "PGRST301" || code === "401";

let running: Promise<SyncResult> | null = null;

/** One sync at a time; a second call while one runs waits for it. */
export function syncNow(store: FieldStore, opts: { pull?: boolean } = {}): Promise<SyncResult> {
  if (running) return running;
  running = run(store, opts.pull !== false).finally(() => {
    running = null;
  });
  return running;
}

async function run(store: FieldStore, pull: boolean): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, offline: true, sent: 0, failed: [] };
  const supabase = createClient();
  let sent = 0;
  const failed: Failed[] = [];
  try {
    // 1. Photos waiting to upload.
    const blobs = await store.blobs();
    for (const b of blobs.filter((x) => !x.uploaded)) {
      const up = await supabase.storage.from("ops-photos").upload(b.path, b.blob, { contentType: b.type || "image/jpeg", upsert: true });
      if (up.error) {
        const m = up.error.message || "";
        if (isNetwork(m)) return { ok: false, offline: true, sent, failed };
        if (/exists|duplicate/i.test(m)) await store.markUploaded(b.id);
        continue; // try again next time
      }
      await store.markUploaded(b.id);
    }
    const uploaded = new Map((await store.blobs()).map((b) => [b.id, b.uploaded]));

    // 2. Changes, oldest first, in batches. A photo goes only once its file is up.
    const box = await store.outbox();
    const ready: Queued[] = box.filter((q) => q.op.t !== "photo" || q.op.deleted || uploaded.get(q.op.id) !== false);
    for (let i = 0; i < ready.length; i += 100) {
      const batch = ready.slice(i, i + 100);
      const { data, error } = await supabase.rpc("ops_wo_sync", { p_ops: batch.map((q) => q.op) });
      if (error) {
        const m = error.message || "";
        if (isNetwork(m)) return { ok: false, offline: true, sent, failed };
        if (isAuth(m, error.code)) return { ok: false, sent, failed, signIn: true, error: "Sign in again to send your changes. They're saved on this phone." };
        return { ok: false, sent, failed, error: m };
      }
      const results = ((data as { results?: { i: number; ok: boolean; error?: string }[] } | null)?.results ?? []) as { i: number; ok: boolean; error?: string }[];
      const done: number[] = [];
      for (const r of results) {
        const q = batch[r.i];
        if (!q) continue;
        if (r.ok) {
          done.push(q.seq);
          sent++;
        } else if (TRANSIENT.test(r.error ?? "") && q.tries < MAX_TRIES) {
          await store.bump(q.seq, r.error ?? "");
        } else {
          done.push(q.seq);
          failed.push({ op: q.op, error: r.error ?? "It couldn't be saved.", at: new Date().toISOString() });
        }
      }
      await store.remove(done);
    }
    if (failed.length) await store.addFailed(failed);

    // 3. The latest from the office and the rest of the crew.
    let bundle: Bundle | null | undefined;
    if (pull) {
      const { data, error } = await supabase.rpc("ops_field_bundle");
      if (error) {
        const m = error.message || "";
        if (isNetwork(m)) return { ok: false, offline: true, sent, failed };
        if (isAuth(m, error.code)) return { ok: false, sent, failed, signIn: true, error: "Sign in again to get the latest. Your work is saved on this phone." };
        return { ok: false, sent, failed, error: m };
      }
      bundle = data as Bundle;
      await store.setBundle(bundle);
      // Uploaded photos for trips no longer on the phone can go.
      const trips = new Set(bundle.trips.map((t) => t.id));
      const stale = (await store.blobs()).filter((b) => b.uploaded && !trips.has(b.trip)).map((b) => b.id);
      await store.dropBlobs(stale);
    }
    return { ok: true, sent, failed, bundle };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (isNetwork(m)) return { ok: false, offline: true, sent, failed };
    return { ok: false, sent, failed, error: m };
  }
}
