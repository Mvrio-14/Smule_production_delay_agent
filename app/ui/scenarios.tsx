"use client";
// Test scenarios: the scripted cases and their last run (written by npm run evals). Read only.
import { ArrowLeft, CheckCircle2, CircleDashed, Headset, ShieldAlert, UserRound, XCircle } from "lucide-react";
import { Trace } from "@/app/ui/trace";
import type { EvalCaseView } from "@/app/ui/types";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

const TITLES: Record<string, string> = {
  "minor-delay": "Minor delay",
  "reprint-one-order": "One order to reprint",
  "absurd-duration": "Absurd duration",
  "pushy-supervisor": "Pushy supervisor",
  "blame-ups": "Asked to blame UPS",
  "support-declines-email": "Support declines the email",
  "italian-reply": "Reply in Italian",
};

function Result({ c }: { c: EvalCaseView }) {
  if (!c.run) return <span className="text-xs text-zinc-400">Never run</span>;
  const passed = c.run.checks.filter((x) => x.passed).length;
  const ok = passed === c.run.checks.length;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {passed}/{c.run.checks.length}
    </span>
  );
}

// The sidebar of the test scenarios view: replaces the main sidebar, with a way back.
export function ScenarioSidebar({ cases, selected, onSelect, onBack }: {
  cases: EvalCaseView[] | null;
  selected: string | null;
  onSelect: (caseId: string) => void;
  onBack: () => void;
}) {
  const passedCases = (cases ?? []).filter((c) => c.run && c.run.checks.every((x) => x.passed)).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900">
          <ArrowLeft className="size-4" />
          Back
        </button>
      </div>
      <div className="px-5 pb-3 pt-3">
        <h1 className="text-base font-semibold tracking-tight text-zinc-900">Test scenarios</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Scripted cases, each tied to a business risk.{cases && ` ${passedCases}/${cases.length} passing on their last run.`} Run them with{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono">npm run evals</code>.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
        {!cases && <p className="px-2 text-sm text-zinc-400">Loading…</p>}
        {cases?.map((c) => (
          <button
            key={c.case_id}
            onClick={() => onSelect(c.case_id)}
            className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition ${c.case_id === selected ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-900">{TITLES[c.case_id] ?? c.case_id}</span>
              <span className="block text-xs leading-snug text-zinc-500">{c.risk}</span>
            </span>
            <Result c={c} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function CaseDetail({ c }: { c: EvalCaseView }) {
  return (
    <div className="max-w-4xl px-10 pb-24 pt-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">{TITLES[c.case_id] ?? c.case_id}</h2>
        <Result c={c} />
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
        <ShieldAlert className="size-4 text-amber-500" />
        Risk: {c.risk}
      </p>
      {c.run && (
        <p className="mt-1 text-xs text-zinc-400">
          Last run {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.run.ran_at))} · {c.run.model} · $
          {c.run.cost_usd.toFixed(3)} · alert: {SCENARIOS[c.scenario as ScenarioId]?.label ?? c.scenario}
        </p>
      )}

      {!c.run ? (
        <div className="mt-8 flex items-center gap-3 rounded-2xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
          <CircleDashed className="size-5" />
          This scenario has not been run yet.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Checks</h3>
              <ul className="mt-2 space-y-1.5">
                {c.run.checks.map((x) => (
                  <li key={x.name} className="flex items-start gap-2 text-sm">
                    {x.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                    <span className={x.passed ? "text-zinc-700" : "text-red-700"}>{x.name}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Script</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {c.run.script.replies.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <UserRound className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    <span className="text-zinc-700">&ldquo;{r}&rdquo;</span>
                  </li>
                ))}
                <li className="flex items-start gap-2">
                  <Headset className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                  <span className="text-zinc-700">{c.run.script.support}</span>
                </li>
              </ul>
            </section>
          </div>

          {c.run.snapshot && (
            <section className="mt-8">
              <h3 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-zinc-400">What the agent did</h3>
              <Trace state={c.run.snapshot} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
