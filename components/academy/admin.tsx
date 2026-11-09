"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Submit, FormMessage } from "@/components/forms";
import { saveLesson, saveQuestion, setLessonVideo } from "@/app/(app)/admin/academy/actions";
import type { AcademyLesson } from "@/lib/types";

export function LessonForm({ lesson }: { lesson: AcademyLesson }) {
  const [state, action] = useActionState(saveLesson, null);
  return (
    <form action={action} className="card col">
      <input type="hidden" name="id" value={lesson.id} />
      <div className="grid3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Title</span><input className="input sm" name="title" defaultValue={lesson.title} required /></label>
        <label className="field"><span className="label">Lesson number</span><input className="input sm" name="number" type="number" min={1} defaultValue={lesson.number} /></label>
        <label className="field"><span className="label">Minutes</span><input className="input sm" name="minutes" type="number" min={1} defaultValue={lesson.minutes ?? ""} /></label>
        <label className="field"><span className="label">Pass mark (%)</span><input className="input sm" name="pass_pct" type="number" min={1} max={100} defaultValue={lesson.pass_pct} /></label>
        <label className="field"><span className="label">Status</span>
          <select className="select sm" name="status" defaultValue={lesson.status}>
            <option value="draft">Draft (admins only)</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Summary (shown under the video)</span><textarea className="textarea" name="summary" rows={3} defaultValue={lesson.summary ?? ""} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="label">Question for the crew (optional)</span><input className="input sm" name="discussion" defaultValue={lesson.discussion ?? ""} /></label>
      </div>
      <FormMessage state={state} />
      <div><Submit className="btn sm">Save lesson</Submit></div>
    </form>
  );
}

/** Uploads the video straight from the browser to storage (videos are too big to pass through the app's server). */
export function VideoUpload({ lessonId, hasVideo }: { lessonId: string; hasVideo: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const mb = Math.round(file.size / 1048576);
    setBusy(`Uploading ${file.name} (${mb} MB). Keep this page open; a 50 MB video takes about a minute on good internet.`);
    const ext = file.name.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
    const path = `${lessonId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("academy").upload(path, file, { contentType: file.type || (ext === "mov" ? "video/quicktime" : "video/mp4"), upsert: false });
    if (up.error) {
      setBusy(null);
      const big = /size|large|exceed/i.test(up.error.message);
      setError(big
        ? `The video is too big for storage right now (${mb} MB). In Supabase, open Storage > Settings and raise the upload file size limit, or ask Claude for a smaller copy.`
        : `The upload didn't work: ${up.error.message}`);
      return;
    }
    const r = await setLessonVideo(lessonId, path);
    setBusy(null);
    if (r.error) {
      await supabase.storage.from("academy").remove([path]);
      setError(r.error);
      return;
    }
    if (input.current) input.current.value = "";
    router.refresh();
  };

  const remove = async () => {
    if (!window.confirm("Remove this lesson's video? Students will see \"coming soon\" until you upload another.")) return;
    setBusy("Removing…");
    const r = await setLessonVideo(lessonId, null);
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  };

  return (
    <div className="col tight">
      <div className="row wrap">
        <label className="btn sm dark" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
          <Upload size={15} /> {hasVideo ? "Replace video" : "Upload video"}
          <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" hidden disabled={Boolean(busy)} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {hasVideo ? <button type="button" className="btn sm ghost" disabled={Boolean(busy)} onClick={remove}>Remove video</button> : null}
      </div>
      {busy ? <div className="small muted">{busy}</div> : null}
      {error ? <div className="alert err" role="alert">{error}</div> : null}
      <div className="tiny faint">MP4 (1080p) works best. The finished lesson video from 07 Final is about 50 MB.</div>
    </div>
  );
}

export type QuestionDraft = { id?: string; sort: number; prompt: string; choices: string[]; answer: number; explain: string | null };

export function QuestionForm({ lessonId, q, n }: { lessonId: string; q?: QuestionDraft; n: number }) {
  const [state, action] = useActionState(saveQuestion, null);
  const choices = [0, 1, 2, 3, 4, 5].map((i) => q?.choices[i] ?? "");
  const shown = Math.min(6, Math.max(4, (q?.choices.length ?? 0) + 1));
  return (
    <form action={action} className="col" style={{ padding: "0 16px 16px" }}>
      {q?.id ? <input type="hidden" name="id" value={q.id} /> : null}
      <input type="hidden" name="lesson_id" value={lessonId} />
      <div className="grid3" style={{ gridTemplateColumns: "1fr 110px" }}>
        <label className="field"><span className="label">Question {n}</span><input className="input sm" name="prompt" defaultValue={q?.prompt ?? ""} required /></label>
        <label className="field"><span className="label">Order</span><input className="input sm" name="sort" type="number" defaultValue={q?.sort ?? n} /></label>
      </div>
      <div className="col tight">
        <span className="label">Choices (tick the right one)</span>
        {choices.slice(0, shown).map((c, i) => (
          <label key={i} className="row" style={{ gap: 10 }}>
            <input type="radio" name="answer" value={i} defaultChecked={q ? q.answer === i : i === 0} />
            <input className="input sm grow" name={`choice_${i}`} defaultValue={c} placeholder={i < 2 ? `Choice ${String.fromCharCode(65 + i)}` : `Choice ${String.fromCharCode(65 + i)} (optional)`} />
          </label>
        ))}
      </div>
      <label className="field"><span className="label">Why (shown after they answer)</span><input className="input sm" name="explain" defaultValue={q?.explain ?? ""} /></label>
      <FormMessage state={state} />
      <div><Submit className="btn sm">{q?.id ? "Save question" : "Add question"}</Submit></div>
    </form>
  );
}
