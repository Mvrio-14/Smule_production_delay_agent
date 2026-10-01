"use client";
// The agent trace. Three levels, from most to least visible:
// 1. who acts: the agent (its explanation) and the humans (their replies and decisions)
// 2. what the agent did: its tool calls, grouped under the turn that made them
// 3. the details: reasoning, inputs and outputs, duration, tokens and cost, folded or muted
import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Headset,
  Mail,
  MessageSquare,
  Search,
  TriangleAlert,
  Truck,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { AgentOrb, Avatar } from "@/app/ui/parts";
import { METHOD_LABELS, STATUS_LABELS, niceDate, simClock, type IncidentState, type Step } from "@/app/ui/types";

const TOOLS: Record<string, { label: string; icon: LucideIcon }> = {
  get_order_context: { label: "Looked up the order", icon: Search },
  message_staff: { label: "Messaged the factory", icon: MessageSquare },
  reschedule_machine: { label: "Updated the plan for a machine", icon: CalendarClock },
  reschedule_orders: { label: "Updated the plan for some orders", icon: CalendarClock },
  message_support: { label: "Briefed support", icon: Headset },
  upgrade_shipping: { label: "Upgraded shipping", icon: Truck },
  message_customer: { label: "Emailed the customer", icon: Mail },
};

const STAGE_LABELS: Record<string, string> = { print: "printing", laminate: "laminating", cut: "cutting", pack: "packing" };

// 240 -> "4h", 80 -> "1h20"
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

const ROLE_LABELS: Record<string, string> = {
  production_supervisor: "Production supervisor",
  buyer: "Buyer, purchasing",
  factory_manager: "Factory manager",
};

// A turn of the agent: one model call and the tools it ran. Tools that run without a model call before them
// (an action executed after support approved it) form a turn of their own.
type Block =
  | { at: string; kind: "agent"; model?: Step; tools: Step[] }
  | { at: string; kind: "reply"; staffId: string; text: string }
  | { at: string; kind: "decision"; approved: boolean; text: string };

function buildBlocks(state: IncidentState): Block[] {
  const events: Block[] = [
    ...state.steps.map((s): Block => ({ at: s.started_at, kind: "agent", model: s.kind === "llm" ? s : undefined, tools: s.kind === "tool" ? [s] : [] })),
    ...state.messages
      .filter((m) => m.sender !== "agent")
      .map((m): Block => ({ at: m.created_at, kind: "reply", staffId: m.sender, text: m.body })),
    ...state.approvals
      .filter((a) => a.decided_at)
      .map((a): Block => ({
        at: a.decided_at!,
        kind: "decision",
        approved: a.status === "approved",
        text: `Support ${a.status === "approved" ? "approved" : "declined"} the ${a.tool_name === "upgrade_shipping" ? "shipping upgrade" : "customer email"} for ${a.order_id}${a.comment ? `: "${a.comment}"` : ""}`,
      })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Attach each tool run to the agent turn right before it.
  const blocks: Block[] = [];
  for (const e of events) {
    const last = blocks.at(-1);
    if (e.kind === "agent" && !e.model && last?.kind === "agent") last.tools.push(...e.tools);
    else blocks.push(e);
  }
  return blocks;
}

export function Trace({ state }: { state: IncidentState }) {
  const { status, trigger_event } = state.incident;
  const blocks = buildBlocks(state);

  return (
    <div>
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-amber-950">Production tracking alert</p>
          <p className="mt-0.5 text-amber-900/80">
            {trigger_event.job_started !== false ? (
              <>
                Order {trigger_event.order_id} has been {STAGE_LABELS[trigger_event.stage] ?? trigger_event.stage} for{" "}
                <span className="font-medium text-amber-950">{duration(trigger_event.planned_stage_minutes + trigger_event.overdue_minutes)}</span> instead of
                the {duration(trigger_event.planned_stage_minutes)} planned.
              </>
            ) : (
              <>
                Order {trigger_event.order_id} has been waiting{" "}
                <span className="font-medium text-amber-950">{duration(trigger_event.planned_stage_minutes + trigger_event.overdue_minutes)}</span> to start{" "}
                {STAGE_LABELS[trigger_event.stage] ?? trigger_event.stage} (the whole step was planned to take {duration(trigger_event.planned_stage_minutes)}).
              </>
            )}{" "}
            Nobody has said why or for how long.
          </p>
        </div>
        <Time>{simClock(state, state.incident.created_at)}</Time>
      </div>

      <ol className="mt-6">
        {blocks.map((b, i) => {
          if (b.kind === "agent") return <AgentTurn key={`a${i}`} state={state} block={b} />;
          if (b.kind === "reply") return <HumanReply key={`r${i}`} state={state} block={b} />;
          return <Decision key={`d${i}`} state={state} block={b} />;
        })}
        <StatusRow state={state} status={status} />
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Time({ children }: { children: ReactNode }) {
  return <span className="shrink-0 pt-0.5 font-mono text-[11px] text-zinc-400">{children}</span>;
}

// A row of the timeline: avatar on the line, content on the right.
function Row({ avatar, children, last }: { avatar: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-4 pb-7">
      {!last && <span className="absolute bottom-0 left-4 top-10 w-px bg-zinc-200" aria-hidden />}
      <span className="relative z-10 flex w-8 shrink-0 justify-center">{avatar}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function AgentTurn({ state, block }: { state: IncidentState; block: Extract<Block, { kind: "agent" }> }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const out = block.model?.output as { text?: string; reasoning?: string } | null | undefined;
  const m = block.model;
  return (
    <Row avatar={<AgentOrb />}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-zinc-900">Late Order Coordinator</span>
        {m && (
          <span className="text-[11px] text-zinc-400">
            {(m.duration_ms / 1000).toFixed(1)}s · {((m.tokens_in ?? 0) + (m.tokens_out ?? 0)).toLocaleString()} tokens
            {m.cost_usd !== null && ` · $${m.cost_usd.toFixed(4)}`}
          </span>
        )}
        <span className="ml-auto">
          <Time>{simClock(state, block.at)}</Time>
        </span>
      </div>

      {out?.text ? (
        <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800">{out.text}</p>
      ) : (
        !m && <p className="mt-1 text-sm text-zinc-500">Ran the action support approved.</p>
      )}

      {out?.reasoning && (
        <div className="mt-2">
          <button onClick={() => setShowReasoning(!showReasoning)} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-700">
            <ChevronRight className={`size-3.5 transition-transform ${showReasoning ? "rotate-90" : ""}`} />
            Thought process
          </button>
          {showReasoning && <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-zinc-200 pl-3 text-xs italic leading-relaxed text-zinc-500">{out.reasoning}</p>}
        </div>
      )}

      {block.tools.length > 0 && (
        <div className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {block.tools.map((t) => (
            <ToolCall key={t.id} step={t} />
          ))}
        </div>
      )}
    </Row>
  );
}

function ToolCall({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const tool = TOOLS[step.tool_name ?? ""] ?? { label: step.tool_name ?? "Tool", icon: Wrench };
  const Icon = tool.icon;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-zinc-50">
        <Icon className={`size-4 shrink-0 ${step.is_error ? "text-red-500" : "text-zinc-400"}`} />
        <span className="min-w-0 flex-1">
          <span className="text-[13px] font-medium text-zinc-800">{tool.label}</span>
          <span className={`ml-2 text-[13px] ${step.is_error ? "text-red-600" : "text-zinc-500"}`}>{step.is_error ? String(step.output?.error) : toolSummary(step)}</span>
        </span>
        <code className="hidden shrink-0 font-mono text-[11px] text-zinc-400 md:inline">{step.tool_name}</code>
        <ChevronRight className={`size-3.5 shrink-0 text-zinc-300 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-2 bg-zinc-50 px-3 pb-3 pt-1 md:grid-cols-2">
          {(["input", "output"] as const).map((k) => (
            <div key={k} className="min-w-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">{k}</p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-4 text-zinc-200">{JSON.stringify(step[k], null, 2)}</pre>
            </div>
          ))}
          <p className="text-[11px] text-zinc-400 md:col-span-2">Ran in {(step.duration_ms / 1000).toFixed(1)}s</p>
        </div>
      )}
    </div>
  );
}

function HumanReply({ state, block }: { state: IncidentState; block: Extract<Block, { kind: "reply" }> }) {
  const person = state.staff.find((s) => s.id === block.staffId);
  const name = person?.name ?? block.staffId;
  return (
    <Row avatar={<Avatar name={name} size="sm" />}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-zinc-900">{name}</span>
        <span className="text-[11px] text-zinc-400">{person ? ROLE_LABELS[person.role] : ""}</span>
        <span className="ml-auto">
          <Time>{simClock(state, block.at)}</Time>
        </span>
      </div>
      <p className="mt-1.5 inline-block max-w-full whitespace-pre-wrap rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2 text-sm text-zinc-800">{block.text}</p>
    </Row>
  );
}

function Decision({ state, block }: { state: IncidentState; block: Extract<Block, { kind: "decision" }> }) {
  const Icon = block.approved ? CheckCircle2 : XCircle;
  return (
    <Row
      avatar={
        <span className={`inline-flex size-7 items-center justify-center rounded-full ${block.approved ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
          <Icon className="size-4" />
        </span>
      }
    >
      <div className="flex items-baseline gap-2 pt-1">
        <span className="text-sm text-zinc-700">{block.text}</span>
        <span className="ml-auto">
          <Time>{simClock(state, block.at)}</Time>
        </span>
      </div>
    </Row>
  );
}

function StatusRow({ state, status }: { state: IncidentState; status: IncidentState["incident"]["status"] }) {
  const Icon = status === "resolved" ? CheckCircle2 : status === "failed" ? AlertCircle : Clock;
  return (
    <Row last avatar={status === "running" ? <AgentOrb active /> : <Icon className={`mt-1 size-5 ${status === "resolved" ? "text-emerald-500" : status === "failed" ? "text-red-500" : "text-zinc-400"}`} />}>
      <p className={`pt-1 text-sm ${status === "running" ? "text-zinc-500" : "font-medium text-zinc-700"}`}>{status === "running" ? "Working…" : STATUS_LABELS[status]}</p>
      {status === "failed" && state.incident.summary && <p className="mt-0.5 text-sm text-red-700">{state.incident.summary}</p>}
    </Row>
  );
}

// One readable line per tool result.
function toolSummary(step: Step): string {
  const input = step.input as Record<string, unknown>;
  const output = step.output as Record<string, unknown>;
  switch (step.tool_name) {
    case "get_order_context": {
      const production = output.production as { stage: string; machine_id: string; site_name: string };
      const supervisor = output.supervisor_on_shift as { name: string } | null;
      return `${production.machine_id}, ${production.site_name} · ${supervisor ? `${supervisor.name} on shift` : "nobody on shift"}`;
    }
    case "message_staff":
      return `to ${String(output.sent_to).replace(/ \(.*\)$/, "")}`;
    case "reschedule_machine":
    case "reschedule_orders": {
      return `${duration(Number(input.delay_minutes))} delay · ${output.on_time} on time, ${output.late_recoverable} recoverable, ${output.late} late`;
    }
    case "upgrade_shipping":
      return `${output.order_id} via ${METHOD_LABELS[String(output.shipping_method)]}, arrives ${niceDate(String(output.new_delivery_date))}`;
    case "message_support":
      return "summary and proposals";
    case "message_customer":
      return `to the customer of ${output.order_id}`;
    default:
      return "";
  }
}
