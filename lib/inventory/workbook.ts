import "server-only";
import { graph, MsError, shareId } from "@/lib/microsoft";
import { colLetter, rangeStart, type Grid } from "@/lib/inventory/sheet";

// The Excel workbook in OneDrive / SharePoint, through Microsoft Graph's Excel API.

export type FileRef = { driveId: string; itemId: string; name: string; webUrl: string | null };

type DriveItem = { id: string; name: string; webUrl?: string; parentReference?: { driveId?: string } };

/** The workbook behind a sharing link (or the ids remembered from last time). */
export async function resolveFile(shareUrl: string, known?: { drive_id: string | null; item_id: string | null }): Promise<FileRef> {
  const pick = (d: DriveItem): FileRef => ({ driveId: d.parentReference?.driveId ?? "", itemId: d.id, name: d.name, webUrl: d.webUrl ?? null });
  if (known?.drive_id && known.item_id) {
    try {
      const d = await graph<DriveItem>(`/drives/${known.drive_id}/items/${known.item_id}?$select=id,name,webUrl,parentReference`);
      return { ...pick(d), driveId: known.drive_id };
    } catch (e) {
      if (!(e instanceof MsError) || ![403, 404].includes(e.status)) throw e;
    }
  }
  let d: DriveItem;
  try {
    d = await graph<DriveItem>(`/shares/${shareId(shareUrl)}/driveItem?$select=id,name,webUrl,parentReference`);
  } catch (e) {
    if (e instanceof MsError && [403, 404].includes(e.status)) {
      throw new MsError(
        "The Microsoft account that's connected can't open this spreadsheet link. Connect with the account that owns the file, or share the file with that account.",
        e.status,
        e.code,
      );
    }
    throw e;
  }
  if (!/\.xlsx$/i.test(d.name)) throw new MsError(`That link opens "${d.name}", which isn't an Excel workbook (.xlsx).`);
  if (!d.parentReference?.driveId) throw new MsError("Microsoft didn't say which drive the workbook is in.");
  return pick(d);
}

const quote = (name: string) => `'${encodeURIComponent(name.replace(/'/g, "''"))}'`;

export class Workbook {
  private session: string | null = null;
  private constructor(public file: FileRef) {}

  private get base() {
    return `/drives/${this.file.driveId}/items/${this.file.itemId}/workbook`;
  }

  private get headers(): Record<string, string> {
    return this.session ? { "workbook-session-id": this.session } : {};
  }

  /** Opens the workbook. A session keeps a whole sync quick and consistent; without one, every call stands alone. */
  static async open(file: FileRef): Promise<Workbook> {
    const wb = new Workbook(file);
    try {
      const s = await graph<{ id: string }>(`${wb.base}/createSession`, { method: "POST", body: { persistChanges: true } });
      wb.session = s?.id ?? null;
    } catch {
      wb.session = null;
    }
    return wb;
  }

  async close() {
    if (!this.session) return;
    try {
      await graph(`${this.base}/closeSession`, { method: "POST", body: {}, headers: this.headers });
    } catch {
      // the session times out on its own
    }
    this.session = null;
  }

  async sheetNames(): Promise<string[]> {
    const r = await graph<{ value: { name: string }[] }>(`${this.base}/worksheets?$select=name`, { headers: this.headers });
    return (r?.value ?? []).map((w) => w.name);
  }

  /** Everything on a tab that has something in it: values plus formulas. */
  async used(sheet: string): Promise<Grid> {
    const r = await graph<{ address: string; values: unknown[][]; formulas: unknown[][] }>(
      `${this.base}/worksheets(${quote(sheet)})/usedRange?$select=address,values,formulas`,
      { headers: this.headers },
    );
    const { top, left } = rangeStart(r.address);
    return { top, left, values: r.values ?? [], formulas: r.formulas ?? [] };
  }

  /** Adds a tab at the end of the workbook. */
  async addSheet(name: string) {
    await graph(`${this.base}/worksheets/add`, { method: "POST", body: { name }, headers: this.headers });
  }

  /** Looks: PATCH a range's format ("" = columnWidth, wrapText, alignment), "/font" or "/fill". Never fatal. */
  async format(sheet: string, address: string, part: "" | "/font" | "/fill", body: Record<string, unknown>) {
    try {
      await graph(`${this.base}/worksheets(${quote(sheet)})/range(address='${address}')/format${part}`, { method: "PATCH", body, headers: this.headers });
    } catch {
      // only looks
    }
  }

  /** Keeps the top rows in view while scrolling. Never fatal. */
  async freezeRows(sheet: string, count: number) {
    try {
      await graph(`${this.base}/worksheets(${quote(sheet)})/freezePanes/freezeRows`, { method: "POST", body: { count }, headers: this.headers });
    } catch {
      // only looks
    }
  }

  /** Writes a block of cells starting at (row, col). Values are entered as if typed. */
  async write(sheet: string, row: number, col: number, values: unknown[][]) {
    const width = Math.max(...values.map((v) => v.length));
    const address = `${colLetter(col)}${row}:${colLetter(col + width - 1)}${row + values.length - 1}`;
    await graph(`${this.base}/worksheets(${quote(sheet)})/range(address='${address}')`, {
      method: "PATCH",
      body: { values },
      headers: this.headers,
    });
  }
}
