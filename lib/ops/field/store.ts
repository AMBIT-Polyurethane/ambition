"use client";

// AMBIT-OPS field app: what the phone keeps when there's no signal. One small IndexedDB database per
// signed-in person: the last download, the changes waiting to be sent (in order), changes the server
// turned down, and photos waiting to upload.

import type { Bundle, Failed, Op, Queued } from "@/lib/ops/field/types";

const VERSION = 1;

export type BlobRow = { id: string; path: string; trip: string; type: string; blob: Blob; uploaded: boolean; at: string };

export type FieldStore = {
  getBundle(): Promise<Bundle | null>;
  setBundle(b: Bundle): Promise<void>;
  outbox(): Promise<Queued[]>;
  add(op: Op): Promise<Queued>;
  replace(seq: number, op: Op): Promise<void>;
  remove(seqs: number[]): Promise<void>;
  bump(seq: number, error: string): Promise<void>;
  failed(): Promise<Failed[]>;
  addFailed(f: Failed[]): Promise<void>;
  clearFailed(): Promise<void>;
  putBlob(r: BlobRow): Promise<void>;
  blob(id: string): Promise<BlobRow | null>;
  blobs(): Promise<BlobRow[]>;
  markUploaded(id: string): Promise<void>;
  dropBlobs(ids: string[]): Promise<void>;
};

const req = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((ok, bad) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
    r.onblocked = () => bad(new Error("Close the other AMBIT A.I. tabs and try again."));
  });
}

/** Opens the person's store. Falls back to memory only (nothing kept) if the browser has no IndexedDB. */
export async function openStore(userId: string): Promise<FieldStore> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb(`ambit-field-${userId}`);
  } catch {
    db = null;
  }
  if (!db) return memoryStore();
  const d = db;
  const tx = (store: string, mode: IDBTransactionMode = "readonly") => d.transaction(store, mode).objectStore(store);
  const done = (t: IDBTransaction) =>
    new Promise<void>((ok, bad) => {
      t.oncomplete = () => ok();
      t.onerror = () => bad(t.error);
      t.onabort = () => bad(t.error);
    });
  return {
    async getBundle() {
      return ((await req(tx("kv").get("bundle"))) as Bundle | undefined) ?? null;
    },
    async setBundle(b) {
      await req(tx("kv", "readwrite").put(b, "bundle"));
    },
    async outbox() {
      return ((await req(tx("outbox").getAll())) as Queued[]).sort((a, b) => a.seq - b.seq);
    },
    async add(op) {
      const row = { op, tries: 0 } as Omit<Queued, "seq">;
      const seq = (await req(tx("outbox", "readwrite").add(row))) as number;
      return { ...row, seq };
    },
    async replace(seq, op) {
      const s = tx("outbox", "readwrite");
      const cur = (await req(s.get(seq))) as Queued | undefined;
      if (cur) await req(s.put({ ...cur, op }));
    },
    async remove(seqs) {
      if (!seqs.length) return;
      const t = d.transaction("outbox", "readwrite");
      for (const s of seqs) t.objectStore("outbox").delete(s);
      await done(t);
    },
    async bump(seq, error) {
      const s = tx("outbox", "readwrite");
      const cur = (await req(s.get(seq))) as Queued | undefined;
      if (cur) await req(s.put({ ...cur, tries: cur.tries + 1, last_error: error }));
    },
    async failed() {
      return ((await req(tx("kv").get("failed"))) as Failed[] | undefined) ?? [];
    },
    async addFailed(f) {
      if (!f.length) return;
      const s = tx("kv", "readwrite");
      const cur = ((await req(s.get("failed"))) as Failed[] | undefined) ?? [];
      await req(s.put([...cur, ...f].slice(-50), "failed"));
    },
    async clearFailed() {
      await req(tx("kv", "readwrite").put([], "failed"));
    },
    async putBlob(r) {
      await req(tx("blobs", "readwrite").put(r));
    },
    async blob(id) {
      return ((await req(tx("blobs").get(id))) as BlobRow | undefined) ?? null;
    },
    async blobs() {
      return (await req(tx("blobs").getAll())) as BlobRow[];
    },
    async markUploaded(id) {
      const s = tx("blobs", "readwrite");
      const cur = (await req(s.get(id))) as BlobRow | undefined;
      if (cur) await req(s.put({ ...cur, uploaded: true }));
    },
    async dropBlobs(ids) {
      if (!ids.length) return;
      const t = d.transaction("blobs", "readwrite");
      for (const id of ids) t.objectStore("blobs").delete(id);
      await done(t);
    },
  };
}

function memoryStore(): FieldStore {
  let bundle: Bundle | null = null;
  let seq = 0;
  let box: Queued[] = [];
  let fails: Failed[] = [];
  const blobs = new Map<string, BlobRow>();
  return {
    getBundle: async () => bundle,
    setBundle: async (b) => void (bundle = b),
    outbox: async () => [...box],
    add: async (op) => {
      const q = { seq: ++seq, op, tries: 0 };
      box.push(q);
      return q;
    },
    replace: async (s, op) => void (box = box.map((q) => (q.seq === s ? { ...q, op } : q))),
    remove: async (seqs) => void (box = box.filter((q) => !seqs.includes(q.seq))),
    bump: async (s, error) => void (box = box.map((q) => (q.seq === s ? { ...q, tries: q.tries + 1, last_error: error } : q))),
    failed: async () => [...fails],
    addFailed: async (f) => void (fails = [...fails, ...f].slice(-50)),
    clearFailed: async () => void (fails = []),
    putBlob: async (r) => void blobs.set(r.id, r),
    blob: async (id) => blobs.get(id) ?? null,
    blobs: async () => [...blobs.values()],
    markUploaded: async (id) => {
      const r = blobs.get(id);
      if (r) blobs.set(id, { ...r, uploaded: true });
    },
    dropBlobs: async (ids) => ids.forEach((i) => blobs.delete(i)),
  };
}
