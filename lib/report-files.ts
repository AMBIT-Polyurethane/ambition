// The paperwork on a Receiving Report (0067): the BOL and the packing list are both needed. Safe to use in the
// browser and on the server.

/** The paperwork on a Receiving Report. Since 0067 each file says what it is; older files don't (shown as "BOL and paperwork"). */
export type ReportFile = { path: string; name: string; kind?: "bol" | "packing" | "other" };
export const FILE_KIND: Record<NonNullable<ReportFile["kind"]>, string> = { bol: "BOL", packing: "Packing list", other: "Other paperwork" };
export function readFiles(v: unknown): ReportFile[] {
  return (Array.isArray(v) ? v : [])
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof (f as { path?: unknown }).path === "string")
    .map((f) => ({
      path: String(f.path),
      name: String(f.name ?? "file").slice(0, 120),
      kind: f.kind === "bol" || f.kind === "packing" || f.kind === "other" ? f.kind : undefined,
    }));
}
/**
 * What paperwork a report has. Files from before BOLs and packing lists were separate (no kind) count as the BOL.
 * `labeled`: at least one file says what it is (a report done since the change).
 */
export function paperwork(files: ReportFile[]) {
  return {
    bol: files.filter((f) => f.kind === "bol" || !f.kind).length,
    packing: files.filter((f) => f.kind === "packing").length,
    labeled: files.some((f) => Boolean(f.kind)),
  };
}
/** A Receiving Report done with no packing list says why at the start of its note. */
export const NO_PACKING = "No packing list: ";
