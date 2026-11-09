"use client";

import { useState, useTransition } from "react";
import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { submitQuiz } from "@/app/(app)/academy/actions";
import type { AcademyQuestion, QuizResult } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** The graded quiz under a lesson: pick one answer per question, then see the score, the right answers and why. */
export function LessonQuiz({ lessonId, questions, passPct, nextHref }: {
  lessonId: string; questions: AcademyQuestion[]; passPct: number; nextHref?: string | null;
}) {
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answered = questions.filter((q) => picks[q.id] != null).length;
  const byId = new Map((result?.results ?? []).map((r) => [r.id, r]));

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await submitQuiz(lessonId, picks);
      if ("error" in r) setError(r.error);
      else {
        setResult(r.result);
        requestAnimationFrame(() => document.getElementById("quiz-score")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      }
    });
  };
  const retake = () => {
    setPicks({});
    setResult(null);
    document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="col" id="quiz">
      {questions.map((q, i) => {
        const r = byId.get(q.id);
        return (
          <fieldset key={q.id} className="card quiz-q" disabled={Boolean(result) || pending}>
            <legend className="quiz-prompt"><span className="quiz-n">{i + 1}</span>{q.prompt}</legend>
            <div className="col tight">
              {q.choices.map((c, ci) => {
                const chosen = picks[q.id] === ci;
                const cls = r ? (ci === r.answer ? "right" : chosen ? "wrong" : "") : chosen ? "on" : "";
                return (
                  <label key={ci} className={`quiz-choice ${cls}`}>
                    <input type="radio" name={q.id} checked={chosen} onChange={() => setPicks((p) => ({ ...p, [q.id]: ci }))} />
                    <span className="quiz-letter">{LETTERS[ci]}</span>
                    <span className="grow">{c}</span>
                    {r && ci === r.answer ? <CircleCheck size={18} className="ok-ic" /> : null}
                    {r && chosen && ci !== r.answer ? <CircleX size={18} className="bad-ic" /> : null}
                  </label>
                );
              })}
            </div>
            {r ? (
              <p className={`small quiz-why ${r.correct ? "ok" : "bad"}`}>
                <b>{r.correct ? "Right." : "Not quite."}</b> {r.explain}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      {error ? <div className="alert err" role="alert">{error}</div> : null}

      {result ? (
        <div id="quiz-score" className={`card quiz-score ${result.passed ? "pass" : "fail"}`}>
          <div className="quiz-big">{result.score} / {result.total}</div>
          <div className="t">{result.passed ? "Passed. Nice work." : `Not yet. You need ${Math.ceil((passPct * result.total) / 100)} of ${result.total} to pass.`}</div>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <button type="button" className="btn dark sm" onClick={retake}><RotateCcw size={15} /> Take it again</button>
            {result.passed && nextHref ? <a className="btn sm" href={nextHref}>Next lesson</a> : null}
          </div>
        </div>
      ) : (
        <button type="button" className="btn block" disabled={answered < questions.length || pending} onClick={submit}>
          {pending ? "Grading…" : answered < questions.length ? `${answered} of ${questions.length} answered` : "Check my answers"}
        </button>
      )}
    </div>
  );
}
