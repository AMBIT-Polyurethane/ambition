"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  CircleDot,
  CircleHelp,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  Hand,
  LoaderCircle,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Pentagon,
  Plus,
  RulerDimensionLine,
  Scissors,
  Spline,
  Tag,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createClient } from "@/lib/supabase/client";
import {
  COLORS,
  MATERIALS,
  SCALES,
  STATUS_TEXT,
  assembly,
  feetInches,
  ftPerPt,
  isFoam,
  itemTotals,
  mainQty,
  num,
  parseLength,
  pitchFactor,
  polygonArea,
  polylineLength,
  readScale,
  subQty,
  type Pt,
  type TItem,
  type TMark,
  type TSheet,
} from "@/lib/takeoff/calc";

export type TFile = { id: string; path: string; file_name: string; size: number | null; pages: number | null; url: string | null };
export type TakeoffInfo = { id: string; name: string; customer: string | null; address: string | null; due_date: string | null; status: string };

type Tool = "select" | "pan" | "scale" | "area" | "linear" | "count" | "cutout";
type View = { z: number; x: number; y: number };
type Toast = { kind: "ok" | "err" | "info"; text: string } | null;
type Draft = Partial<TItem> & { id?: string };

const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon; hint: string }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2, hint: "Click a shape to select it (Delete removes it). Drag to move around; scroll to zoom." },
  { id: "pan", label: "Move", key: "H", icon: Hand, hint: "Drag to move around the plan. Scroll to zoom." },
  { id: "scale", label: "Scale", key: "S", icon: RulerDimensionLine, hint: "Click both ends of a dimension you know, then type how long it really is." },
  { id: "area", label: "Area", key: "A", icon: Pentagon, hint: "Click each corner. Click the first corner again or press Enter to finish. Hold Shift for straight lines." },
  { id: "linear", label: "Linear", key: "L", icon: Spline, hint: "Click along the wall. Double-click or press Enter to finish. Hold Shift for straight lines." },
  { id: "count", label: "Count", key: "C", icon: CircleDot, hint: "Click each one." },
  { id: "cutout", label: "Cutout", key: "X", icon: Scissors, hint: "Trace an area to take out of the selected area item (stairwells, open to below)." },
];

const TOOL_KIND: Partial<Record<Tool, TItem["kind"]>> = { area: "area", cutout: "area", linear: "linear", count: "count" };
const toolFor = (it: Pick<TItem, "kind">): Tool => (it.kind === "area" ? "area" : it.kind === "linear" ? "linear" : "count");

const PRESETS: { label: string; item: Draft }[] = [
  { label: "Exterior walls", item: { name: "Exterior walls", kind: "linear", material: "open_cell", thickness_in: 5.5, height_ft: 9 } },
  { label: "Attic floor / ceiling", item: { name: "Ceiling, vented attic", kind: "area", material: "blown_fiberglass" } },
  { label: "Roof deck", item: { name: "Roof deck", kind: "area", material: "open_cell", thickness_in: 7, pitch: 6 } },
  { label: "Vaulted ceiling", item: { name: "Vaulted ceiling", kind: "area", material: "closed_cell", thickness_in: 3, pitch: 6 } },
  { label: "Rim joist", item: { name: "Rim joist", kind: "linear", material: "closed_cell", thickness_in: 3, height_ft: 1 } },
  { label: "Garage common wall", item: { name: "Garage common wall", kind: "linear", material: "fiberglass_batts", height_ft: 9 } },
  { label: "Can lights (count)", item: { name: "Recessed lights", kind: "count", material: "other" } },
];

// ------------------------------------------------------------------ pdf.js (loaded only on this screen)
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsLoad: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  pdfjsLoad ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjsLoad;
}

type TextItem = { str?: string; transform?: number[]; height?: number };

/** Sheet number from the title block (bottom-right corner) and the scale written on the sheet. */
function readSheet(items: TextItem[], toView: (x: number, y: number) => number[], W: number, H: number) {
  const SHEET_NO = /^[A-Z]{1,3}\s?[-.]?\s?\d{1,3}(?:\.\d{1,3})?[A-Z]?$/;
  let best: { s: string; h: number; corner: boolean } | null = null;
  const words: string[] = [];
  for (const it of items) {
    const s = (it.str ?? "").trim();
    if (!s) continue;
    words.push(s);
    if (!SHEET_NO.test(s) || !it.transform) continue;
    const [vx, vy] = toView(it.transform[4], it.transform[5]);
    const corner = vx > W * 0.6 && vy > H * 0.55;
    const h = it.height ?? 0;
    if (!best || (corner && !best.corner) || (corner === best.corner && h > best.h)) best = { s: s.replace(/\s+/g, ""), h, corner };
  }
  return { name: best && best.h >= 8 ? best.s : null, scale: readScale(words.join(" ")) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function TakeoffWorkspace(props: { takeoff: TakeoffInfo; files: TFile[]; sheets: TSheet[]; items: TItem[]; marks: TMark[] }) {
  const t = props.takeoff;
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState(props.files);
  const [sheets, setSheets] = useState(props.sheets);
  const [items, setItems] = useState(props.items);
  const [marks, setMarks] = useState(props.marks);
  const [status, setStatus] = useState(t.status);
  const [sheetId, setSheetId] = useState<string | null>(props.sheets[0]?.id ?? null);
  const [itemId, setItemId] = useState<string | null>(props.items[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selMark, setSelMark] = useState<string | null>(null);
  const [view, setView] = useState<View>({ z: 0.3, x: 0, y: 0 });
  const [renderScale, setRenderScale] = useState(1.5);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [scaleDlg, setScaleDlg] = useState<{ dist: number | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [labels, setLabels] = useState(true);
  const [help, setHelp] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [sheetQ, setSheetQ] = useState("");

  const vpRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const docs = useRef(new Map<string, Promise<PDFDocumentProxy>>());
  const undoStack = useRef<string[]>([]);
  const pending = useRef<{ points: Pt[]; cutout: boolean; kind: TItem["kind"] } | null>(null);
  const keys = useRef({ shift: false, space: false });
  const viewRef = useRef(view);
  viewRef.current = view;

  const sheet = sheets.find((s) => s.id === sheetId) ?? null;
  const W = sheet?.width_pt ?? 0;
  const H = sheet?.height_pt ?? 0;
  const sheetMap = useMemo(() => new Map(sheets.map((s) => [s.id, s])), [sheets]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const item = itemId ? itemMap.get(itemId) ?? null : null;
  const sheetMarks = useMemo(() => marks.filter((m) => m.sheet_id === sheetId), [marks, sheetId]);

  const flash = useCallback((kind: "ok" | "err" | "info", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((cur) => (cur && cur.text === text ? null : cur)), kind === "err" ? 7000 : 3500);
  }, []);

  // ---------------------------------------------------------------- loading and drawing the plan
  const loadDoc = useCallback(
    (fileId: string): Promise<PDFDocumentProxy> => {
      let p = docs.current.get(fileId);
      if (!p) {
        const f = files.find((x) => x.id === fileId);
        if (!f?.url) return Promise.reject(new Error("The plan file couldn't be opened. Reload the page."));
        p = pdfjs().then((m) => m.getDocument({ url: f.url!, isEvalSupported: false }).promise);
        docs.current.set(fileId, p);
        p.catch(() => docs.current.delete(fileId));
      }
      return p;
    },
    [files],
  );

  const fit = useCallback(() => {
    const vp = vpRef.current;
    if (!vp || !W || !H) return;
    const r = vp.getBoundingClientRect();
    const z = Math.max(0.02, Math.min((r.width - 32) / W, (r.height - 32) / H));
    setView({ z, x: (r.width - W * z) / 2, y: (r.height - H * z) / 2 });
  }, [W, H]);

  useEffect(() => {
    fit();
    setDraft([]);
    setSelMark(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, W, H]);

  // Sharper picture as you zoom in (redrawn a moment after zooming stops).
  useEffect(() => {
    if (!W || !H) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cap = Math.sqrt(16_000_000 / (W * H));
    const want = clamp(view.z * dpr, 0.75, cap);
    const steps = [0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];
    const pick = Math.min(steps.find((x) => x >= want * 0.92) ?? steps[steps.length - 1], cap);
    if (Math.abs(pick - renderScale) < 0.01) return;
    const id = window.setTimeout(() => setRenderScale(pick), 220);
    return () => window.clearTimeout(id);
  }, [view.z, W, H, renderScale]);

  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setRendering(true);
    loadDoc(sheet.file_id)
      .then(async (doc) => {
        const page = await doc.getPage(sheet.page);
        if (cancelled) return;
        const vp = page.getViewport({ scale: renderScale });
        const off = document.createElement("canvas");
        off.width = Math.floor(vp.width);
        off.height = Math.floor(vp.height);
        task = page.render({ canvas: off, viewport: vp });
        await task.promise;
        if (cancelled) return;
        const c = canvasRef.current;
        if (c) {
          c.width = off.width;
          c.height = off.height;
          c.getContext("2d")?.drawImage(off, 0, 0);
        }
        setRendering(false);
      })
      .catch((e: { name?: string; message?: string }) => {
        if (cancelled || e?.name === "RenderingCancelledException") return;
        setRendering(false);
        flash("err", e?.message || "The plan didn't open.");
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [sheet?.id, sheet?.file_id, sheet?.page, renderScale, loadDoc, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- zoom and move
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      setView((v) => {
        const z = clamp(v.z * k, 0.02, 24);
        return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [sheetId]);

  const zoomBy = (k: number) => {
    const el = vpRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    setView((v) => {
      const z = clamp(v.z * k, 0.02, 24);
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
    });
  };

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(e.clientX - r.left - v.x) / v.z, (e.clientY - r.top - v.y) / v.z];
  };

  // Shift: straight lines (every 45 degrees) from the last point.
  const snap = (p: Pt): Pt => {
    if (!keys.current.shift || !draft.length) return p;
    const [x0, y0] = draft[draft.length - 1];
    const dx = p[0] - x0;
    const dy = p[1] - y0;
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len];
  };

  // ---------------------------------------------------------------- saving shapes
  const addMark = async (points: Pt[], cutout = false, forItem?: TItem) => {
    if (!sheet) return;
    const kind = TOOL_KIND[cutout ? "cutout" : tool] ?? (points.length === 1 ? "count" : null);
    let target = forItem ?? item;
    if (!target || (kind && target.kind !== kind)) {
      // The selected item measures something else: use the latest item of the right kind, or make one.
      const alt = [...items].reverse().find((i) => i.kind === kind);
      if (alt && !forItem) {
        target = alt;
        setItemId(alt.id);
      } else {
        pending.current = { points, cutout, kind: kind ?? "area" };
        setEditor({ kind: kind ?? "area", color: COLORS[items.length % COLORS.length] });
        flash("info", `Name what you just ${kind === "count" ? "counted" : "traced"} and it's saved to it.`);
        return;
      }
    }
    if (cutout && target.kind !== "area") {
      flash("err", "Cutouts come out of an area item. Pick an area item first.");
      return;
    }
    const pts = points.map((p) => [round2(p[0]), round2(p[1])] as Pt);
    const tmp: TMark = { id: `tmp-${Math.random().toString(36).slice(2)}`, item_id: target.id, sheet_id: sheet.id, points: pts, cutout };
    setMarks((m) => [...m, tmp]);
    const { data, error } = await supabase
      .from("takeoff_marks")
      .insert({ takeoff_id: t.id, item_id: target.id, sheet_id: sheet.id, points: pts, cutout })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      setMarks((m) => m.filter((x) => x.id !== tmp.id));
      flash("err", `Didn't save: ${error?.message ?? "try again"}`);
      return;
    }
    setMarks((m) => m.map((x) => (x.id === tmp.id ? { ...x, id: data.id } : x)));
    undoStack.current.push(data.id);
    if (!sheet.ft_per_pt && target.kind !== "count") flash("info", "Saved. This sheet has no scale yet, so it has no size until you set one (Scale tool).");
  };

  const deleteMark = async (id: string) => {
    const gone = marks.find((m) => m.id === id);
    if (!gone) return;
    setMarks((m) => m.filter((x) => x.id !== id));
    setSelMark(null);
    if (id.startsWith("tmp-")) return;
    const { error } = await supabase.from("takeoff_marks").delete().eq("id", id);
    if (error) {
      setMarks((m) => [...m, gone]);
      flash("err", `Didn't delete: ${error.message}`);
    }
  };

  const finish = () => {
    if ((tool === "area" || tool === "cutout") && draft.length >= 3) void addMark(draft, tool === "cutout");
    else if (tool === "linear" && draft.length >= 2) void addMark(draft);
    else if (draft.length) flash("info", tool === "linear" ? "A line needs at least 2 points." : "An area needs at least 3 corners.");
    setDraft([]);
  };

  const undo = () => {
    if (draft.length) {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    const last = undoStack.current.pop();
    if (last) void deleteMark(last);
  };

  const pickTool = (id: Tool) => {
    setTool(id);
    setDraft([]);
    if (id !== "select") setSelMark(null);
    if (id === "scale") flash("info", "Click both ends of a dimension you know, like an outside wall.");
  };

  // ---------------------------------------------------------------- mouse / touch on the plan
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; pan: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2 || !sheet) return;
    // Buttons floating over the plan (the no-scale note) work as buttons.
    if ((e.target as HTMLElement).closest("button, a, input, select, label")) return;
    const pan = tool === "pan" || tool === "select" || e.button === 1 || keys.current.space;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, pan };
    if (pan) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.pan && d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    }
    if (tool !== "select" && tool !== "pan" && sheet) setHover(snap(toPt(e)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !sheet) return;
    if (tool === "select") {
      setSelMark(null);
      return;
    }
    if (d.pan) return;
    const p = snap(toPt(e));
    if (tool === "count") {
      void addMark([p]);
      return;
    }
    if (tool === "scale") {
      const pts = [...draft, p];
      if (pts.length >= 2) {
        setDraft(pts.slice(0, 2));
        setScaleDlg({ dist: dist(pts[0], pts[1]) });
      } else setDraft(pts);
      return;
    }
    if (draft.length) {
      const last = draft[draft.length - 1];
      if (dist(p, last) * view.z < 6) {
        finish(); // second click of a double-click
        return;
      }
      if ((tool === "area" || tool === "cutout") && draft.length >= 3 && dist(p, draft[0]) * view.z < 12) {
        finish();
        return;
      }
    }
    setDraft((dft) => [...dft, p]);
  };

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") keys.current.shift = true;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]") || editor || scaleDlg) return;
      if (e.key === " ") {
        keys.current.space = true;
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (draft.length) setDraft([]);
        else if (selMark) setSelMark(null);
        else pickTool("select");
        return;
      }
      if (e.key === "Enter") {
        finish();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (draft.length) setDraft((d) => d.slice(0, -1));
        else if (selMark) void deleteMark(selMark);
        return;
      }
      if (e.key === "+" || e.key === "=") return zoomBy(1.25);
      if (e.key === "-") return zoomBy(0.8);
      if (e.key.toLowerCase() === "f") return fit();
      const tk = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (tk) pickTool(tk.id);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") keys.current.shift = false;
      if (e.key === " ") keys.current.space = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // ---------------------------------------------------------------- uploading plans
  const upload = async (list: FileList | File[]) => {
    const pdfs = Array.from(list).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) {
      flash("err", "Plans need to be PDF files.");
      return;
    }
    let firstNew: string | null = null;
    let sort = sheets.length;
    for (const file of pdfs) {
      try {
        setBusy(`Uploading ${file.name} (${num(file.size / 1048576, 1)} MB)…`);
        const path = `${t.id}/${crypto.randomUUID()}.pdf`;
        const up = await supabase.storage.from("plans").upload(path, file, { contentType: "application/pdf", upsert: false });
        if (up.error) throw new Error(`${file.name} didn't upload: ${up.error.message}`);
        setBusy(`Opening ${file.name}…`);
        const m = await pdfjs();
        const doc = await m.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
        const { data: frow, error: fe } = await supabase
          .from("takeoff_files")
          .insert({ takeoff_id: t.id, path, file_name: file.name.slice(0, 200), size: file.size, pages: doc.numPages })
          .select("id, path, file_name, size, pages")
          .single<Omit<TFile, "url">>();
        if (fe || !frow) throw new Error(fe?.message ?? "Couldn't save the file.");
        const signed = await supabase.storage.from("plans").createSignedUrl(path, 60 * 60 * 12);
        docs.current.set(frow.id, Promise.resolve(doc));
        setFiles((f) => [...f, { ...frow, url: signed.data?.signedUrl ?? null }]);

        const rows: Omit<TSheet, "id">[] = [];
        let scaled = 0;
        for (let p = 1; p <= doc.numPages; p++) {
          setBusy(`Reading ${file.name}: sheet ${p} of ${doc.numPages}…`);
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          let name: string | null = null;
          let scale: { label: string; ftPerIn: number } | null = null;
          try {
            const tc = await page.getTextContent();
            const r = readSheet(tc.items as TextItem[], (x, y) => vp.convertToViewportPoint(x, y), vp.width, vp.height);
            name = r.name;
            scale = r.scale;
          } catch {
            // no text on this page (a scan): name and scale by hand
          }
          if (scale) scaled++;
          rows.push({
            file_id: frow.id,
            page: p,
            name: name ?? (doc.numPages > 1 ? `Page ${p}` : file.name.replace(/\.pdf$/i, "").slice(0, 60)),
            width_pt: round2(vp.width),
            height_pt: round2(vp.height),
            ft_per_pt: scale ? ftPerPt(scale.ftPerIn) : null,
            scale_label: scale?.label ?? null,
            scale_source: scale ? "read" : null,
            sort: ++sort,
          });
          page.cleanup();
        }
        const saved: TSheet[] = [];
        for (let i = 0; i < rows.length; i += 200) {
          const { data, error } = await supabase
            .from("takeoff_sheets")
            .insert(rows.slice(i, i + 200).map((r) => ({ ...r, takeoff_id: t.id })))
            .select("*");
          if (error) throw new Error(error.message);
          saved.push(...((data ?? []) as TSheet[]).map((s) => ({ ...s, width_pt: Number(s.width_pt), height_pt: Number(s.height_pt), ft_per_pt: s.ft_per_pt === null ? null : Number(s.ft_per_pt) })));
        }
        saved.sort((a, b) => a.sort - b.sort);
        setSheets((s) => [...s, ...saved]);
        firstNew ??= saved[0]?.id ?? null;
        flash("ok", `${file.name}: ${saved.length} sheet${saved.length === 1 ? "" : "s"} added${scaled ? `, scale read on ${scaled}` : ""}.`);
      } catch (e) {
        flash("err", e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(null);
    if (firstNew && !sheetId) setSheetId(firstNew);
    else if (firstNew) setSheetId(firstNew);
  };

  // ---------------------------------------------------------------- sheets
  const saveSheets = async (ids: string[], patch: Partial<TSheet>) => {
    setSheets((s) => s.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("takeoff_sheets").update(patch).in("id", ids);
    if (error) flash("err", `Didn't save: ${error.message}`);
  };

  const applyScale = (ftPt: number, label: string, source: string, scope: "this" | "unscaled" | "all") => {
    if (!sheet) return;
    const ids =
      scope === "this" ? [sheet.id] : scope === "all" ? sheets.map((s) => s.id) : sheets.filter((s) => !s.ft_per_pt || s.id === sheet.id).map((s) => s.id);
    void saveSheets(ids, { ft_per_pt: ftPt, scale_label: label, scale_source: source });
    setScaleDlg(null);
    setDraft([]);
    setTool("select");
    flash("ok", `Scale set on ${ids.length} sheet${ids.length === 1 ? "" : "s"}: ${label}.`);
  };

  const deleteFile = async (f: TFile) => {
    const n = sheets.filter((s) => s.file_id === f.id).length;
    if (!window.confirm(`Remove ${f.file_name} (${n} sheet${n === 1 ? "" : "s"}) and everything measured on it?`)) return;
    const { error } = await supabase.from("takeoff_files").delete().eq("id", f.id);
    if (error) return flash("err", error.message);
    await supabase.storage.from("plans").remove([f.path]);
    const gone = new Set(sheets.filter((s) => s.file_id === f.id).map((s) => s.id));
    setSheets((s) => s.filter((x) => !gone.has(x.id)));
    setMarks((m) => m.filter((x) => !gone.has(x.sheet_id)));
    setFiles((x) => x.filter((y) => y.id !== f.id));
    if (sheetId && gone.has(sheetId)) setSheetId(sheets.find((s) => !gone.has(s.id))?.id ?? null);
  };

  // ---------------------------------------------------------------- items
  const saveItem = async (d: Draft) => {
    const row = {
      name: (d.name || "").trim() || "Untitled item",
      kind: d.kind ?? "area",
      color: d.color ?? COLORS[0],
      material: d.material || null,
      thickness_in: d.thickness_in ?? null,
      r_value: d.r_value?.toString().trim() || null,
      height_ft: d.kind === "linear" ? d.height_ft ?? null : null,
      pitch: d.kind === "area" ? d.pitch ?? null : null,
      deduct_sqft: d.kind === "linear" ? Number(d.deduct_sqft ?? 0) : 0,
    };
    if (d.id) {
      const { error } = await supabase.from("takeoff_items").update(row).eq("id", d.id);
      if (error) return flash("err", `Didn't save: ${error.message}`);
      setItems((list) => list.map((x) => (x.id === d.id ? { ...x, ...row } : x)));
      setEditor(null);
      return;
    }
    const { data, error } = await supabase
      .from("takeoff_items")
      .insert({ ...row, takeoff_id: t.id, sort: items.length + 1 })
      .select("*")
      .single<TItem>();
    if (error || !data) return flash("err", `Didn't save: ${error?.message ?? "try again"}`);
    const it: TItem = { ...data, thickness_in: data.thickness_in === null ? null : Number(data.thickness_in), height_ft: data.height_ft === null ? null : Number(data.height_ft), pitch: data.pitch === null ? null : Number(data.pitch), deduct_sqft: Number(data.deduct_sqft ?? 0) };
    setItems((list) => [...list, it]);
    setItemId(it.id);
    setEditor(null);
    const p = pending.current;
    pending.current = null;
    if (p && p.kind === it.kind) void addMark(p.points, p.cutout, it);
    else {
      setDraft([]);
      setTool(toolFor(it));
    }
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("takeoff_items").delete().eq("id", id);
    if (error) return flash("err", error.message);
    setItems((l) => l.filter((x) => x.id !== id));
    setMarks((m) => m.filter((x) => x.item_id !== id));
    if (itemId === id) setItemId(null);
    setEditor(null);
  };

  const toggleHidden = async (it: TItem) => {
    setItems((l) => l.map((x) => (x.id === it.id ? { ...x, hidden: !x.hidden } : x)));
    await supabase.from("takeoff_items").update({ hidden: !it.hidden }).eq("id", it.id);
  };

  const saveStatus = async (s: string) => {
    setStatus(s);
    const { error } = await supabase.from("takeoffs").update({ status: s }).eq("id", t.id);
    if (error) flash("err", error.message);
  };

  // ---------------------------------------------------------------- what's on screen
  const totals = useMemo(() => new Map(items.map((i) => [i.id, itemTotals(i, marks, sheetMap)])), [items, marks, sheetMap]);
  const here = useMemo(() => new Map(items.map((i) => [i.id, itemTotals(i, marks, sheetMap, sheetId ?? undefined)])), [items, marks, sheetMap, sheetId]);
  const foamBf = (mat: string) => items.filter((i) => i.material === mat).reduce((a, i) => a + (totals.get(i.id)?.bf ?? 0), 0);
  const ftPt = sheet?.ft_per_pt ?? null;
  const z = view.z;

  const liveLabel = (() => {
    if (!hover || !draft.length || !sheet) return null;
    const pts = [...draft, hover];
    if (tool === "scale") return `${num(dist(draft[0], hover) / 72, 2)}" on paper`;
    if (!ftPt) return "No scale yet";
    if (tool === "linear") {
      const seg = dist(draft[draft.length - 1], hover) * ftPt;
      const all = polylineLength(pts) * ftPt;
      return draft.length > 1 ? `${feetInches(seg)} · total ${feetInches(all)}` : feetInches(seg);
    }
    if (pts.length >= 3) return `${num(polygonArea(pts) * ftPt * ftPt * (tool === "area" && item ? pitchFactor(item.pitch) : 1))} sq ft`;
    return feetInches(dist(draft[draft.length - 1], hover) * ftPt);
  })();

  const markLabel = (m: TMark, it: TItem): { x: number; y: number; text: string } | null => {
    if (!ftPt || it.kind === "count") return null;
    if (it.kind === "area") {
      const cx = m.points.reduce((a, p) => a + p[0], 0) / m.points.length;
      const cy = m.points.reduce((a, p) => a + p[1], 0) / m.points.length;
      const a = polygonArea(m.points) * ftPt * ftPt * pitchFactor(it.pitch);
      return { x: cx, y: cy, text: `${m.cutout ? "−" : ""}${num(a)} sq ft` };
    }
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < m.points.length - 1; i++) {
      const l = dist(m.points[i], m.points[i + 1]);
      if (l > bestLen) {
        bestLen = l;
        best = i;
      }
    }
    const a = m.points[best];
    const b = m.points[best + 1] ?? a;
    return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, text: feetInches(polylineLength(m.points) * ftPt) };
  };

  const filteredSheets = sheets.filter((s) => !sheetQ.trim() || `${s.name ?? ""} ${s.page}`.toLowerCase().includes(sheetQ.trim().toLowerCase()));
  const activeTool = TOOLS.find((x) => x.id === tool)!;
  const drawing = draft.length > 0 && (tool === "area" || tool === "linear" || tool === "cutout");

  return (
    <div className="to-ws">
      {/* ------------------------------------------------ top bar */}
      <header className="to-top">
        <Link href="/takeoff" className="to-back" aria-label="All takeoffs">
          <ChevronLeft size={18} />
          <span>Takeoffs</span>
        </Link>
        <div className="to-title">
          <b className="ellipsis">{t.name}</b>
          <span className="ellipsis">{[t.customer, t.address].filter(Boolean).join(" · ") || "Takeoff"}</span>
        </div>
        <label className="to-status">
          <span className="sr-only">Status</span>
          <select className="select sm" value={status} onChange={(e) => void saveStatus(e.target.value)}>
            {Object.entries(STATUS_TEXT).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="to-iconbtn" onClick={() => setHelp((h) => !h)} aria-label="Shortcuts and tips" aria-expanded={help}>
          <CircleHelp size={18} />
        </button>
        <Link href={`/takeoff/${t.id}/report`} className="btn sm">
          <FileText size={16} /> Report
        </Link>
      </header>

      {/* ------------------------------------------------ sheets */}
      <aside className="to-sheets" aria-label="Plan sheets">
        <div className="to-panel-head">
          <span className="eyebrow">Sheets · {sheets.length}</span>
          <button type="button" className="to-mini" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
            <FileUp size={14} /> Add plans
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {sheets.length > 8 ? (
          <input className="input sm to-find" type="search" placeholder="Find a sheet" value={sheetQ} onChange={(e) => setSheetQ(e.target.value)} aria-label="Find a sheet" />
        ) : null}
        <div className="to-sheet-list">
          {files.map((f) => {
            const mine = filteredSheets.filter((s) => s.file_id === f.id);
            if (!mine.length && sheetQ) return null;
            return (
              <div key={f.id} className="to-file">
                <div className="to-file-name">
                  <span className="ellipsis" title={f.file_name}>{f.file_name}</span>
                  <button type="button" className="to-x" onClick={() => void deleteFile(f)} aria-label={`Remove ${f.file_name}`}>
                    <Trash2 size={13} />
                  </button>
                </div>
                {mine.map((s) => {
                  const n = marks.filter((m) => m.sheet_id === s.id).length;
                  const on = s.id === sheetId;
                  return renaming === s.id ? (
                    <form
                      key={s.id}
                      className="to-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = String(new FormData(e.currentTarget).get("n") ?? "").trim().slice(0, 80);
                        if (v) void saveSheets([s.id], { name: v });
                        setRenaming(null);
                      }}
                    >
                      <input className="input sm" name="n" defaultValue={s.name ?? ""} autoFocus aria-label="Sheet name" onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
                    </form>
                  ) : (
                    <div key={s.id} className={`to-sheet${on ? " on" : ""}`}>
                      <button type="button" className="to-sheet-open" onClick={() => setSheetId(s.id)} aria-current={on ? "page" : undefined}>
                        <span className="pg">{s.page}</span>
                        <span className="col tight" style={{ minWidth: 0 }}>
                          <b className="ellipsis">{s.name || `Page ${s.page}`}</b>
                          <span className={s.ft_per_pt ? "faint" : "warn-text"}>
                            {s.ft_per_pt ? s.scale_label || "Scale set" : "No scale"}
                            {n ? ` · ${n} shape${n === 1 ? "" : "s"}` : ""}
                          </span>
                        </span>
                      </button>
                      <button type="button" className="to-x" onClick={() => setRenaming(s.id)} aria-label={`Rename ${s.name ?? `page ${s.page}`}`}>
                        <Pencil size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!files.length ? <p className="tiny faint" style={{ margin: "4px 6px" }}>No plans yet.</p> : null}
        </div>
      </aside>

      {/* ------------------------------------------------ plan */}
      <section className="to-center" aria-label="Plan">
        <div className="to-tools" role="toolbar" aria-label="Measuring tools">
          {TOOLS.map((x) => {
            const I = x.icon;
            return (
              <button key={x.id} type="button" className={`to-tool${tool === x.id ? " on" : ""}`} onClick={() => pickTool(x.id)} aria-pressed={tool === x.id} title={`${x.label} (${x.key})`} disabled={!sheet}>
                <I size={16} />
                <span>{x.label}</span>
                <kbd>{x.key}</kbd>
              </button>
            );
          })}
          <span className="grow" />
          {drawing ? (
            <>
              <button type="button" className="to-tool" onClick={undo} title="Take back the last point (Backspace)">
                <Undo2 size={16} /> <span>Undo point</span>
              </button>
              <button type="button" className="to-tool on" onClick={finish} title="Finish (Enter)">
                <Check size={16} /> <span>Finish</span>
              </button>
            </>
          ) : null}
          <button type="button" className={`to-tool${labels ? " on2" : ""}`} onClick={() => setLabels((v) => !v)} aria-pressed={labels} title="Show sizes on the plan">
            <Tag size={16} /> <span>Sizes</span>
          </button>
          <div className="to-zoom">
            <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><Minus size={15} /></button>
            <span>{Math.round(z * 100)}%</span>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><Plus size={15} /></button>
            <button type="button" onClick={fit} aria-label="Fit the sheet on screen" title="Fit (F)"><Maximize size={15} /></button>
          </div>
        </div>

        <div
          ref={vpRef}
          className={`to-vp tool-${tool}${dropping ? " dropping" : ""}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
          }}
        >
          {sheet && W && H ? (
            <div className="to-stage" style={{ width: W, height: H, transform: `translate(${view.x}px, ${view.y}px) scale(${z})` }}>
              <canvas ref={canvasRef} style={{ width: W, height: H }} />
              <svg className="to-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
                <defs>
                  <pattern id="to-hatch" width={8 / z} height={8 / z} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width={8 / z} height={8 / z} fill="rgba(255,255,255,0.6)" />
                    <line x1="0" y1="0" x2="0" y2={8 / z} stroke="#18181b" strokeWidth={1.4 / z} />
                  </pattern>
                </defs>
                {sheetMarks.map((m) => {
                  const it = itemMap.get(m.item_id);
                  if (!it || it.hidden) return null;
                  const sel = m.id === selMark;
                  const act = it.id === itemId;
                  const pick = (e: React.PointerEvent) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    setSelMark(m.id);
                    setItemId(it.id);
                  };
                  const pe = tool === "select" ? "visiblePainted" : "none";
                  if (it.kind === "count") {
                    return m.points.map((p, i) => (
                      <circle key={`${m.id}-${i}`} cx={p[0]} cy={p[1]} r={(sel ? 9 : 7) / z} fill={it.color} stroke="#fff" strokeWidth={2 / z} onPointerDown={pick} style={{ pointerEvents: pe }} />
                    ));
                  }
                  const pts = m.points.map((p) => p.join(",")).join(" ");
                  if (it.kind === "area") {
                    return (
                      <polygon
                        key={m.id}
                        points={pts}
                        fill={m.cutout ? "url(#to-hatch)" : it.color}
                        fillOpacity={m.cutout ? 1 : sel ? 0.42 : act ? 0.3 : 0.2}
                        stroke={m.cutout ? "#18181b" : it.color}
                        strokeWidth={(sel ? 4 : act ? 2.5 : 1.8) / z}
                        strokeDasharray={m.cutout ? `${6 / z} ${4 / z}` : undefined}
                        strokeLinejoin="round"
                        onPointerDown={pick}
                        style={{ pointerEvents: pe }}
                      />
                    );
                  }
                  return (
                    <polyline
                      key={m.id}
                      points={pts}
                      fill="none"
                      stroke={it.color}
                      strokeOpacity={sel ? 1 : 0.82}
                      strokeWidth={(sel ? 8 : act ? 6 : 5) / z}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      onPointerDown={pick}
                      style={{ pointerEvents: pe }}
                    />
                  );
                })}
                {labels
                  ? sheetMarks.map((m) => {
                      const it = itemMap.get(m.item_id);
                      if (!it || it.hidden || (it.id !== itemId && m.id !== selMark)) return null;
                      const l = markLabel(m, it);
                      if (!l) return null;
                      return (
                        <text key={`l-${m.id}`} x={l.x} y={l.y} className="to-lbl" fontSize={12 / z} strokeWidth={3.5 / z} textAnchor="middle" dominantBaseline="middle">
                          {l.text}
                        </text>
                      );
                    })
                  : null}
                {draft.length ? (
                  <g className="to-draft">
                    {tool === "area" || tool === "cutout" ? (
                      <polygon points={[...draft, ...(hover ? [hover] : [])].map((p) => p.join(",")).join(" ")} fill={tool === "cutout" ? "#18181b" : item?.color ?? "#e33527"} fillOpacity={0.15} stroke="none" />
                    ) : null}
                    <polyline
                      points={[...draft, ...(hover ? [hover] : [])].map((p) => p.join(",")).join(" ")}
                      fill="none"
                      stroke={tool === "scale" ? "#0ea5e9" : tool === "cutout" ? "#18181b" : item?.color ?? "#e33527"}
                      strokeWidth={3 / z}
                      strokeDasharray={`${8 / z} ${5 / z}`}
                    />
                    {draft.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 && draft.length >= 3 ? 7 : 4.5) / z} fill="#fff" stroke="#18181b" strokeWidth={1.6 / z} />
                    ))}
                  </g>
                ) : null}
              </svg>
            </div>
          ) : (
            <div className="to-empty">
              <FileUp size={34} />
              <b>{busy ? "Working on your plans…" : "Drop your plan PDFs here"}</b>
              <span>Every page becomes a sheet. Sheet numbers and scales are read for you when the PDF has them.</span>
              <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                <FileUp size={18} /> Choose PDF files
              </button>
            </div>
          )}

          {liveLabel && hover ? (
            <div className="to-live" style={{ left: hover[0] * z + view.x + 14, top: hover[1] * z + view.y + 14 }}>
              {liveLabel}
            </div>
          ) : null}
          {rendering && sheet ? (
            <div className="to-loading">
              <LoaderCircle size={16} className="spin" /> Drawing the sheet…
            </div>
          ) : null}
          {busy ? (
            <div className="to-busy" role="status">
              <LoaderCircle size={18} className="spin" /> {busy}
            </div>
          ) : null}
          {sheet && !sheet.ft_per_pt && !busy ? (
            <div className="to-banner">
              This sheet has no scale yet.
              <button type="button" className="linkbtn" onClick={() => pickTool("scale")}>Measure a dimension</button>
              or
              <button type="button" className="linkbtn" onClick={() => setScaleDlg({ dist: null })}>pick the scale</button>
            </div>
          ) : null}
          {dropping ? <div className="to-dropzone">Drop PDFs to add them</div> : null}
        </div>

        <div className="to-foot">
          <span>
            Scale <b>{sheet?.scale_label || (sheet?.ft_per_pt ? "set" : "not set")}</b>
            {sheet?.scale_source === "read" ? <span className="faint"> (read from the sheet)</span> : null}
            {sheet ? (
              <button type="button" className="linkbtn" onClick={() => setScaleDlg({ dist: null })}>Change</button>
            ) : null}
          </span>
          <span className="grow ellipsis faint">{activeTool.hint}</span>
          {selMark ? (
            <button type="button" className="linkbtn" onClick={() => void deleteMark(selMark)}>
              <Trash2 size={13} /> Delete shape
            </button>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------ items */}
      <aside className="to-items" aria-label="Measured items">
        <div className="to-panel-head">
          <span className="eyebrow">Items · {items.length}</span>
          <button type="button" className="to-mini" onClick={() => setEditor({ kind: "area", color: COLORS[items.length % COLORS.length] })}>
            <Plus size={14} /> New item
          </button>
        </div>
        <div className="to-item-list">
          {items.length === 0 ? (
            <div className="to-hint">
              <b>Start with what you&apos;re measuring.</b>
              <span>Pick one to start, then trace it on the plan:</span>
              <div className="to-presets">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" className="chip sm" onClick={() => setEditor({ ...p.item, color: COLORS[items.length % COLORS.length] })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {items.map((it) => {
            const tot = totals.get(it.id)!;
            const h = here.get(it.id)!;
            const on = it.id === itemId;
            return (
              <div key={it.id} className={`to-item${on ? " on" : ""}`} style={{ borderColor: on ? it.color : undefined }}>
                <button
                  type="button"
                  className="to-item-main"
                  onClick={() => {
                    setItemId(it.id);
                    // Ready to draw it: the matching tool (an area item keeps Cutout if that's what's picked).
                    if (!(tool === "cutout" && it.kind === "area") && TOOL_KIND[tool] !== it.kind) pickTool(toolFor(it));
                  }}
                >
                  <span className={`sw ${it.kind}`} style={{ background: it.color }} aria-hidden="true" />
                  <span className="col tight" style={{ minWidth: 0 }}>
                    <b className="ellipsis">{it.name}</b>
                    {assembly(it) ? <span className="tiny muted ellipsis">{assembly(it)}</span> : null}
                    <span className="qty">{mainQty(it, tot)}</span>
                    {subQty(it, tot) ? <span className="tiny faint">{subQty(it, tot)}</span> : null}
                    {sheet && h.marks && h.marks !== tot.marks ? <span className="tiny faint">This sheet: {mainQty(it, h)}</span> : null}
                  </span>
                </button>
                <div className="to-item-actions">
                  <button type="button" onClick={() => void toggleHidden(it)} aria-label={`${it.hidden ? "Show" : "Hide"} ${it.name}`} title={it.hidden ? "Show" : "Hide"}>
                    {it.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button type="button" onClick={() => setEditor({ ...it })} aria-label={`Edit ${it.name}`} title="Edit">
                    <Pencil size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="to-sum">
          <div><b>{num(foamBf("open_cell"))}</b><span>open-cell board ft</span></div>
          <div><b>{num(foamBf("closed_cell"))}</b><span>closed-cell board ft</span></div>
          <div>
            <b>{num(items.filter((i) => !isFoam(i.material) && i.kind !== "count").reduce((a, i) => a + (totals.get(i.id)?.sqft ?? 0), 0))}</b>
            <span>sq ft other</span>
          </div>
        </div>
      </aside>

      {toast ? (
        <div className={`to-toast ${toast.kind}`} role={toast.kind === "err" ? "alert" : "status"}>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Close"><X size={15} /></button>
        </div>
      ) : null}

      {help ? (
        <div className="to-help" role="dialog" aria-label="Shortcuts">
          <div className="row between"><b>Shortcuts</b><button type="button" className="to-x" onClick={() => setHelp(false)} aria-label="Close"><X size={15} /></button></div>
          <ul>
            {TOOLS.map((x) => <li key={x.id}><kbd>{x.key}</kbd> {x.label}</li>)}
            <li><kbd>Enter</kbd> finish the shape</li>
            <li><kbd>Esc</kbd> cancel</li>
            <li><kbd>Backspace</kbd> take back a point, or delete the selected shape</li>
            <li><kbd>Ctrl/⌘ Z</kbd> undo</li>
            <li><kbd>Shift</kbd> straight lines (every 45°)</li>
            <li><kbd>Space</kbd> + drag to move while drawing</li>
            <li><kbd>F</kbd> fit the sheet · scroll to zoom</li>
          </ul>
        </div>
      ) : null}

      {editor ? (
        <ItemEditor
          draft={editor}
          used={editor.id ? marks.filter((m) => m.item_id === editor.id).length : 0}
          onCancel={() => {
            pending.current = null;
            setEditor(null);
          }}
          onSave={(d) => void saveItem(d)}
          onDelete={editor.id ? () => void deleteItem(editor.id!) : undefined}
        />
      ) : null}

      {scaleDlg && sheet ? (
        <ScaleDialog
          dist={scaleDlg.dist}
          sheet={sheet}
          unscaled={sheets.filter((s) => !s.ft_per_pt).length}
          total={sheets.length}
          onCancel={() => {
            setScaleDlg(null);
            setDraft([]);
          }}
          onApply={applyScale}
        />
      ) : null}
    </div>
  );
}

// ======================================================================================

function ItemEditor({ draft, used, onCancel, onSave, onDelete }: { draft: Draft; used: number; onCancel: () => void; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [sure, setSure] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return (
    <div className="to-modal" role="dialog" aria-modal="true" aria-label={d.id ? "Edit item" : "New item"} onClick={onCancel}>
      <form
        className="to-modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(d);
        }}
      >
        <div className="row between">
          <b style={{ fontSize: 17 }}>{d.id ? "Edit item" : "New item"}</b>
          <button type="button" className="to-x" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        {!d.id ? (
          <div className="to-presets">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip sm" onClick={() => setD((x) => ({ ...x, ...p.item }))}>{p.label}</button>
            ))}
          </div>
        ) : null}
        <label className="field">
          <span className="label">Name</span>
          <input className="input sm" value={d.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="Exterior walls" autoFocus required maxLength={80} />
        </label>
        <div className="field">
          <span className="label">Measured as</span>
          <div className="seg" role="radiogroup" aria-label="Measured as">
            {([
              ["area", "Area"],
              ["linear", "Walls / lengths"],
              ["count", "Count"],
            ] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={d.kind === k ? "on" : ""} disabled={used > 0 && d.kind !== k} onClick={() => set({ kind: k })}>
                {l}
              </button>
            ))}
          </div>
          {used > 0 ? <span className="tiny faint">{used} shape{used === 1 ? "" : "s"} drawn, so this can&apos;t change.</span> : null}
        </div>
        <div className="grid2">
          <label className="field">
            <span className="label">Material</span>
            <select className="select sm" value={d.material ?? ""} onChange={(e) => set({ material: e.target.value || null })}>
              <option value="">None</option>
              {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {d.kind !== "count" ? (
            <label className="field">
              <span className="label">Thickness (inches)</span>
              <input className="input sm" inputMode="decimal" value={d.thickness_in ?? ""} onChange={(e) => set({ thickness_in: numOrNull(e.target.value) })} placeholder={isFoam(d.material) ? "5.5" : "Optional"} />
            </label>
          ) : null}
          <label className="field">
            <span className="label">R-value</span>
            <input className="input sm" value={d.r_value ?? ""} onChange={(e) => set({ r_value: e.target.value })} placeholder="Optional, e.g. R-21" maxLength={20} />
          </label>
          {d.kind === "linear" ? (
            <label className="field">
              <span className="label">Wall height</span>
              <input
                className="input sm"
                defaultValue={d.height_ft ? feetInches(d.height_ft) : ""}
                onChange={(e) => set({ height_ft: parseLength(e.target.value) })}
                placeholder={`9'-0" (blank = length only)`}
              />
            </label>
          ) : null}
          {d.kind === "linear" && d.height_ft ? (
            <label className="field">
              <span className="label">Openings to take out (sq ft)</span>
              <input className="input sm" inputMode="decimal" value={d.deduct_sqft ?? ""} onChange={(e) => set({ deduct_sqft: numOrNull(e.target.value) ?? 0 })} placeholder="Windows and doors" />
            </label>
          ) : null}
          {d.kind === "area" ? (
            <label className="field">
              <span className="label">Slope</span>
              <select className="select sm" value={d.pitch ?? ""} onChange={(e) => set({ pitch: numOrNull(e.target.value) })}>
                <option value="">Flat</option>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((r) => <option key={r} value={r}>{r}/12 pitch (× {num(pitchFactor(r), 3)})</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <div className="field">
          <span className="label">Color</span>
          <div className="to-colors" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={d.color === c} aria-label={c} className={d.color === c ? "on" : ""} style={{ background: c }} onClick={() => set({ color: c })} />
            ))}
          </div>
        </div>
        {isFoam(d.material) && d.thickness_in && d.kind !== "count" ? (
          <p className="tiny faint" style={{ margin: 0 }}>Board feet = square feet × {num(Number(d.thickness_in), 2)}&quot;.</p>
        ) : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="submit" className="btn sm">{d.id ? "Save" : "Add item"}</button>
          <button type="button" className="btn sm dark" onClick={onCancel}>Cancel</button>
          <span className="grow" />
          {onDelete ? (
            sure ? (
              <button type="button" className="btn sm danger" onClick={onDelete}>Delete it{used ? ` and ${used} shape${used === 1 ? "" : "s"}` : ""}</button>
            ) : (
              <button type="button" className="btn sm ghost" onClick={() => setSure(true)}><Trash2 size={14} /> Delete</button>
            )
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ScaleDialog({
  dist: measured,
  sheet,
  unscaled,
  total,
  onCancel,
  onApply,
}: {
  dist: number | null;
  sheet: TSheet;
  unscaled: number;
  total: number;
  onCancel: () => void;
  onApply: (ftPt: number, label: string, source: string, scope: "this" | "unscaled" | "all") => void;
}) {
  const [len, setLen] = useState("");
  const [preset, setPreset] = useState(sheet.scale_label ?? "");
  const [scope, setScope] = useState<"this" | "unscaled" | "all">("this");
  const real = parseLength(len);
  const fromMeasure = measured && real ? real / measured : null;
  const near = fromMeasure ? SCALES.find((s) => Math.abs(ftPerPt(s.ftPerIn) - fromMeasure) / fromMeasure < 0.03) : null;
  const picked = SCALES.find((s) => s.label === preset);
  const apply = () => {
    if (measured) {
      if (!fromMeasure) return;
      onApply(near ? ftPerPt(near.ftPerIn) : fromMeasure, near ? near.label : `Measured: ${feetInches(real!)} = ${num(measured / 72, 2)}"`, "calibrated", scope);
    } else if (picked) onApply(ftPerPt(picked.ftPerIn), picked.label, "picked", scope);
  };
  return (
    <div className="to-modal" role="dialog" aria-modal="true" aria-label="Set the scale" onClick={onCancel}>
      <form
        className="to-modal-panel"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="row between">
          <b style={{ fontSize: 17 }}>Set the scale</b>
          <button type="button" className="to-x" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        {measured ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              The line you drew is {num(measured / 72, 2)}&quot; long on the paper. How long is it in real life?
            </p>
            <label className="field">
              <span className="label">Real length</span>
              <input className="input" value={len} onChange={(e) => setLen(e.target.value)} placeholder={`24'-0"`} autoFocus inputMode="text" />
            </label>
            {fromMeasure ? (
              <p className="small" style={{ margin: 0 }}>
                {near ? (
                  <>That matches <b>{near.label}</b>. The exact standard scale will be used.</>
                ) : (
                  <>About 1&quot; = {num(fromMeasure * 72, 2)}&apos; on paper. Check another dimension after.</>
                )}
              </p>
            ) : len ? (
              <p className="small warn-text" style={{ margin: 0 }}>Type it like 24&apos;-0&quot;, 24.5 or 294&quot;.</p>
            ) : null}
          </>
        ) : (
          <label className="field">
            <span className="label">Scale written on the sheet</span>
            <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">Pick one</option>
              {SCALES.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
            <span className="tiny faint">Not sure? Close this, pick the Scale tool and click both ends of a dimension you know.</span>
          </label>
        )}
        {total > 1 ? (
          <div className="field">
            <span className="label">Use it on</span>
            <div className="seg" role="radiogroup" aria-label="Use it on">
              <button type="button" role="radio" aria-checked={scope === "this"} className={scope === "this" ? "on" : ""} onClick={() => setScope("this")}>This sheet</button>
              <button type="button" role="radio" aria-checked={scope === "unscaled"} className={scope === "unscaled" ? "on" : ""} onClick={() => setScope("unscaled")}>No-scale sheets ({unscaled})</button>
              <button type="button" role="radio" aria-checked={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All {total}</button>
            </div>
          </div>
        ) : null}
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="btn sm" disabled={measured ? !fromMeasure : !picked}>Use this scale</button>
          <button type="button" className="btn sm dark" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
