// The app was updated while a page was open, and that old page tried to use something the new version
// doesn't have any more: a Save button (server action) or a piece of the page's code (a "chunk").
// Reloading gets the new version. Shared by app/error.tsx and app/global-error.tsx.

const ACTION = /was not found on the server|UnrecognizedActionError|Failed to find Server Action/i;
const CHUNK = /ChunkLoadError|Loading chunk [\w./-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export type Stale = "action" | "chunk" | null;

export function staleKind(e: unknown): Stale {
  const err = e as { name?: string; message?: string } | null;
  const text = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (ACTION.test(text)) return "action";
  if (CHUNK.test(text)) return "chunk";
  return null;
}

/** Reload once on its own (not over and over if something else is wrong). True if it reloaded. */
export function reloadOnce(): boolean {
  try {
    const KEY = "ambit-stale-reload";
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no storage: still reload, the 60s guard just can't apply
  }
  window.location.reload();
  return true;
}
