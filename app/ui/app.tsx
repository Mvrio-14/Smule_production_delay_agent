"use client";
// Main screen: sidebar with the alerts and the incidents, the agent trace in the middle, chat windows docked bottom right.
// The page polls the incident every second, so each agent step shows up as soon as it is saved.
import { useCallback, useEffect, useState } from "react";
import { Activity, Coins, FlaskConical, Gauge, Hand, LayoutDashboard, Moon, Sun, Timer, type LucideIcon } from "lucide-react";
import { StaffChat, SupportChat } from "@/app/ui/chats";
import { Dashboard } from "@/app/ui/dashboard";
import { AgentOrb, BrandMark, Stat, StatusBadge, StatusDot } from "@/app/ui/parts";
import { CaseDetail, ScenarioSidebar } from "@/app/ui/scenarios";
import { Trace } from "@/app/ui/trace";
import { STATUS_LABELS, simClock, type EvalCaseView, type IncidentState, type IncidentSummary } from "@/app/ui/types";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

const SCENARIO_UI: Record<ScenarioId, { icon: LucideIcon; when: string }> = {
  night: { icon: Moon, when: "SM-10401 · Friday 02:10 · night shift" },
  day: { icon: Sun, when: "SM-10501 · Thursday 10:40 · day shift" },
};

const scenarioOf = (orderId: string) => (Object.keys(SCENARIOS) as ScenarioId[]).find((id) => SCENARIOS[id].alert.order_id === orderId);

// Staff the agent wrote to, in the order it first wrote to them.
function staffInChat(state: IncidentState): string[] {
  return [...new Set(state.messages.filter((m) => m.sender === "agent" && m.recipient !== "support").map((m) => m.recipient))];
}

async function fetchIncidents(): Promise<IncidentSummary[]> {
  return (await fetch("/api/incidents")).json();
}

async function fetchState(id: number): Promise<IncidentState | null> {
  const res = await fetch(`/api/incidents/${id}`);
  return res.ok ? res.json() : null;
}

export function App() {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<IncidentState | null>(null);
  const [starting, setStarting] = useState<ScenarioId | null>(null);
  const [view, setView] = useState<"incidents" | "dashboard" | "scenarios">("incidents");
  const [cases, setCases] = useState<EvalCaseView[] | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  // Load the test scenarios (their last run) each time the view opens.
  useEffect(() => {
    if (view !== "scenarios") return;
    fetch("/api/evals")
      .then((r) => r.json())
      .then((list: EvalCaseView[]) => {
        setCases(list);
        setSelectedCase((current) => current ?? list[0]?.case_id ?? null);
      });
  }, [view]);

  const loadState = useCallback(() => {
    if (selected !== null) fetchState(selected).then((s) => s && setState(s));
  }, [selected]);

  // On first load, show the latest incident.
  useEffect(() => {
    fetchIncidents().then((list) => {
      setIncidents(list);
      setSelected((current) => current ?? list[0]?.id ?? null);
    });
  }, []);

  // Poll the selected incident about every second, one request at a time. Stop once it is closed.
  useEffect(() => {
    if (selected === null) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const poll = async () => {
      const s = await fetchState(selected);
      if (!active) return;
      if (s) setState(s);
      if (!s || !["resolved", "failed"].includes(s.incident.status)) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selected]);

  // Keep the status dots of the sidebar in sync with the open incident.
  const incidentList = incidents.map((i) => (state && i.id === state.incident.id ? { ...i, status: state.incident.status } : i));

  async function simulateAlert(scenario: ScenarioId) {
    setStarting(scenario);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Could not start the alert (${res.status})`);
      const { id } = await res.json();
      setIncidents(await fetchIncidents());
      setState(null);
      setSelected(id);
      setView("incidents");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setStarting(null);
    }
  }

  const current = state && state.incident.id === selected ? state : null;

  return (
    <div className="flex h-screen bg-zinc-50">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold text-zinc-900">Late Order Coordinator</p>
            <p className="text-xs text-zinc-500">Sticker Mule · internal tool demo</p>
          </div>
        </div>

        {view === "scenarios" ? (
          <ScenarioSidebar cases={cases} selected={selectedCase} onSelect={setSelectedCase} onBack={() => setView("incidents")} />
        ) : (
          <>
        <nav className="mb-5 space-y-0.5 px-3">
          {(
            [
              ["incidents", "Incidents", Activity],
              ["dashboard", "Dashboard", LayoutDashboard],
              ["scenarios", "Test scenarios", FlaskConical],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${view === id ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50"}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="px-3">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">Simulate an alert</p>
          <div className="space-y-1.5">
            {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => {
              const Icon = SCENARIO_UI[id].icon;
              return (
                <button
                  key={id}
                  onClick={() => simulateAlert(id)}
                  disabled={starting !== null}
                  className="group flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left transition hover:border-zinc-300 hover:shadow-sm disabled:opacity-50"
                >
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 transition group-hover:bg-zinc-900 group-hover:text-white">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-900">{starting === id ? "Starting…" : SCENARIOS[id].label}</span>
                    <span className="block text-xs text-zinc-500">{SCENARIO_UI[id].when}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">Incidents</p>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-4">
            {incidentList.length === 0 && <p className="px-2 text-sm text-zinc-400">No incident yet.</p>}
            {incidentList.map((i) => {
              const scenario = scenarioOf(i.order_id);
              return (
                <button
                  key={i.id}
                  onClick={() => {
                    if (i.id !== selected) setState(null);
                    setSelected(i.id);
                    setView("incidents");
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${i.id === selected && view === "incidents" ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                >
                  <StatusDot status={i.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-900">
                      #{i.id} · {scenario ? SCENARIOS[scenario].label : i.order_id}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {i.order_id} · {STATUS_LABELS[i.status]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
          </>
        )}

        <div className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
          Model <span className="font-mono text-zinc-700">{current?.incident.model ?? incidents[0]?.model ?? "—"}</span>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {view === "dashboard" ? (
          <Dashboard
            onOpen={(id) => {
              if (id !== selected) setState(null);
              setSelected(id);
              setView("incidents");
            }}
          />
        ) : view === "scenarios" ? (
          (() => {
            const c = cases?.find((x) => x.case_id === selectedCase);
            return c ? <CaseDetail c={c} /> : <p className="p-10 text-sm text-zinc-500">Loading…</p>;
          })()
        ) : selected === null ? (
          <div className="flex h-full items-center justify-center p-10">
            <div className="max-w-md text-center">
              <AgentOrb size="lg" />
              <h2 className="mt-4 text-lg font-semibold text-zinc-900">Simulate an alert to watch the agent work</h2>
              <p className="mt-2 text-sm text-zinc-500">
                The production tracking system reports an order behind its plan. The agent finds out why from the factory, updates the plan, and briefs
                support. You play the factory staff and the support team in the chats at the bottom right.
              </p>
            </div>
          </div>
        ) : current ? (
          <div className="max-w-4xl px-10 pb-[520px] pt-8">
            <Header state={current} />
            <div className="mt-8">
              <Trace state={current} />
            </div>
          </div>
        ) : (
          <p className="p-8 text-sm text-zinc-500">Loading…</p>
        )}
      </main>

      {current && view === "incidents" && (
        <div className="fixed bottom-0 right-6 flex items-end gap-3">
          {/* Keyed by incident so unread counters start fresh for each incident. */}
          {staffInChat(current).length === 0 ? (
            <StaffChat key={`staff-${current.incident.id}`} state={current} onChange={loadState} />
          ) : (
            staffInChat(current).map((id) => <StaffChat key={`${id}-${current.incident.id}`} state={current} staffId={id} onChange={loadState} />)
          )}
          <SupportChat key={`support-${current.incident.id}`} state={current} onChange={loadState} />
        </div>
      )}
    </div>
  );
}

// Incident title, status and the headline metrics.
function Header({ state }: { state: IncidentState }) {
  const { incident, steps, messages, approvals } = state;
  const scenario = scenarioOf(incident.order_id);
  const tokens = steps.reduce((sum, s) => sum + (s.tokens_in ?? 0) + (s.tokens_out ?? 0), 0);
  const cost = steps.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
  const humanTouches = messages.filter((m) => m.sender !== "agent").length + approvals.filter((a) => a.decided_at).length;

  // Time from the alert to the first message to support (simulated time).
  const firstSupport = messages.find((m) => m.recipient === "support");
  const toSupport = firstSupport
    ? Math.round((new Date(firstSupport.sim_time).getTime() - new Date(incident.trigger_event.detected_at).getTime()) / 60_000)
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Incident #{incident.id}</h1>
        <StatusBadge status={incident.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {scenario ? SCENARIOS[scenario].label : "Alert"} · order {incident.order_id} · alert at {simClock(state, incident.created_at)} factory time
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Alert to support" icon={<Timer className="size-3.5" />} value={toSupport === null ? "—" : `${toSupport} min`} />
        <Stat label="Human touches" icon={<Hand className="size-3.5" />} value={humanTouches} />
        <Stat label="Tokens" icon={<Gauge className="size-3.5" />} value={tokens.toLocaleString()} />
        <Stat label="Cost" icon={<Coins className="size-3.5" />} value={`$${cost.toFixed(3)}`} />
      </div>
    </div>
  );
}
