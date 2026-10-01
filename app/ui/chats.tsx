"use client";
// Chat windows docked at the bottom right: one per staff member the agent writes to, plus the support inbox.
// You play each of these people.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Headset, Mail, SendHorizontal, TriangleAlert, Truck } from "lucide-react";
import { EXTRA_COST_USD, type ShippingMethod } from "@/lib/ship-dates";
import { AgentOrb, Avatar } from "@/app/ui/parts";
import { METHOD_LABELS, hhmm, type Approval, type IncidentState } from "@/app/ui/types";

// A window that can be opened or closed. When closed, new items show as an unread badge.
function ChatWindow({ avatar, title, subtitle, count, children, footer, wide }: {
  avatar: ReactNode;
  title: string;
  subtitle: string;
  count: number;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(count);
  const unread = open ? 0 : Math.max(0, count - seen);
  const bottom = useRef<HTMLDivElement>(null);

  // While open, scroll to the newest item.
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: "end" });
  }, [open, count]);

  // Everything shown while the window was open counts as read.
  function toggle() {
    if (open) setSeen(count);
    setOpen(!open);
  }

  return (
    <div className={`flex ${wide ? "w-[460px]" : "w-[360px]"} flex-col overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10`}>
      <button onClick={toggle} className="flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50">
        <span className="relative">
          {avatar}
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-ping rounded-full bg-red-500" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-900">{title}</span>
          <span className="block truncate text-xs text-zinc-500">{subtitle}</span>
        </span>
        {unread > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span>}
        {open ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronUp className="size-4 text-zinc-400" />}
      </button>
      {open && (
        <>
          <div className="h-[440px] space-y-4 overflow-y-auto border-t border-zinc-100 bg-zinc-50/70 p-4">
            {children}
            <div ref={bottom} />
          </div>
          {footer}
        </>
      )}
    </div>
  );
}

function Bubble({ mine, author, time, children }: { mine: boolean; author: string; time: string; children: ReactNode }) {
  return (
    <div className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      {!mine && <AgentOrb size="sm" />}
      <div className={`flex min-w-0 max-w-[88%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <span className="mb-1 text-[11px] text-zinc-400">
          {author} · {time}
        </span>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            mine ? "rounded-tr-md bg-zinc-900 text-white" : "rounded-tl-md border border-zinc-200 bg-white text-zinc-800 shadow-sm"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="pt-16 text-center text-sm text-zinc-400">{children}</p>;
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) alert((await res.json()).error ?? "Something went wrong");
}

// ---------------------------------------------------------------------------
// Staff chats: one per staff member the agent writes to (supervisor, buyer...). You answer as that person.
// Without staffId, an empty window waits for the first message.
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  production_supervisor: "Production supervisor",
  buyer: "Buyer, purchasing",
  factory_manager: "Factory manager",
};

export function StaffChat({ state, staffId, onChange }: { state: IncidentState; staffId?: string; onChange: () => void }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const person = state.staff.find((s) => s.id === staffId);
  const messages = staffId ? state.messages.filter((m) => m.sender === staffId || m.recipient === staffId) : [];
  const lastAgentMessage = state.messages.filter((m) => m.sender === "agent" && m.recipient !== "support").at(-1);
  const waiting = state.incident.status === "waiting_for_reply" && lastAgentMessage?.recipient === staffId;
  const firstName = person?.name.split(" ")[0];

  async function send() {
    if (!draft.trim() || !waiting) return;
    setSending(true);
    await post(`/api/incidents/${state.incident.id}/reply`, { body: draft });
    setDraft("");
    setSending(false);
    onChange();
  }

  return (
    <ChatWindow
      avatar={person ? <Avatar name={person.name} /> : <Avatar name="Factory" />}
      title={person ? person.name : "Factory floor"}
      subtitle={person ? `You play ${firstName} · ${ROLE_LABELS[person.role] ?? person.role}` : "The agent has not written yet"}
      count={messages.length}
      footer={
        <div className="flex items-center gap-2 border-t border-zinc-100 bg-white p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={!waiting || sending}
            placeholder={waiting ? `Reply as ${firstName}…` : "The agent is not waiting for your reply"}
            className="h-10 flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition focus:border-zinc-400 focus:bg-white disabled:text-zinc-400"
          />
          <button
            onClick={send}
            disabled={!waiting || sending || !draft.trim()}
            className="inline-flex size-10 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-200"
            aria-label="Send"
          >
            <SendHorizontal className="size-4" />
          </button>
        </div>
      }
    >
      {messages.length === 0 && <Empty>No message yet.</Empty>}
      {messages.map((m) => (
        <Bubble key={m.id} mine={m.sender !== "agent"} author={m.sender === "agent" ? "Delay Agent" : `You, ${firstName}`} time={hhmm(m.sim_time)}>
          {m.body}
        </Bubble>
      ))}
    </ChatWindow>
  );
}

// ---------------------------------------------------------------------------
// Support chat: the agent posts one readable summary, with a decision row per proposal under it
// (approve with one click, or refuse, optionally with a comment for the agent).
// ---------------------------------------------------------------------------

export function SupportChat({ state, onChange }: { state: IncidentState; onChange: () => void }) {
  const resolved = state.incident.status === "resolved";
  const summaries = state.messages.filter((m) => m.recipient === "support");

  // Each proposal goes under the last summary posted before it.
  const underSummary = (i: number) =>
    state.approvals.filter((a) => {
      const after = new Date(a.created_at) >= new Date(summaries[i].created_at);
      const next = summaries[i + 1];
      return after && (!next || new Date(a.created_at) < new Date(next.created_at));
    });
  const orphans = state.approvals.filter((a) => summaries.length === 0 || new Date(a.created_at) < new Date(summaries[0].created_at));
  const pending = state.approvals.filter((a) => a.status === "pending").length;

  const count = summaries.length + orphans.length + state.customerMessages.length + (resolved ? 1 : 0);

  return (
    <ChatWindow
      avatar={
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
          <Headset className="size-4" />
        </span>
      }
      title="Support team"
      subtitle={pending > 0 ? `You play support · ${pending} decision${pending > 1 ? "s" : ""} waiting` : "You play support"}
      count={count}
      wide
    >
      {count === 0 && <Empty>Nothing for support yet.</Empty>}
      {orphans.map((a) => (
        <DecisionRow key={a.id} approval={a} onChange={onChange} />
      ))}
      {summaries.map((m, i) => (
        <SummaryCard key={m.id} body={m.body} time={hhmm(m.sim_time)}>
          {underSummary(i).length > 0 && (
            <div className="border-t border-zinc-100 bg-zinc-50/80 px-4 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                {underSummary(i).some((a) => a.status === "pending") ? "Needs your decision" : "Decisions"}
              </p>
              <div className="space-y-2">
                {underSummary(i).map((a) => (
                  <DecisionRow key={a.id} approval={a} onChange={onChange} />
                ))}
              </div>
            </div>
          )}
        </SummaryCard>
      ))}
      {state.customerMessages.map((m) => (
        <p key={m.id} className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
          <Mail className="size-3.5" />
          Email sent to the customer of {m.order_id}
        </p>
      ))}
      {resolved && state.incident.summary && (
        <div className="flex gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-emerald-900">Incident closed</p>
            <p className="mt-0.5 whitespace-pre-wrap text-emerald-900/75">{state.incident.summary.replaceAll("**", "")}</p>
          </div>
        </div>
      )}
    </ChatWindow>
  );
}

// The agent's briefing: the problem in one line, the details below, then the decisions (children).
function SummaryCard({ body, time, children }: { body: string; time: string; children?: ReactNode }) {
  const [headline, ...rest] = body.split("\n");
  const details = rest.join("\n").trim();
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-4 pb-3 pt-3.5">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400">
          <AgentOrb size="sm" />
          <span className="font-medium text-zinc-600">Delay Agent</span>
          <span>· {time}</span>
        </div>
        <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-zinc-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          {headline}
        </p>
        {details && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-600">{details.replaceAll("**", "")}</p>}
      </div>
      {children}
    </div>
  );
}

// One proposal: what it is, the buttons while pending, the decision once made.
function DecisionRow({ approval: a, onChange }: { approval: Approval; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [comment, setComment] = useState("");
  const isUpgrade = a.tool_name === "upgrade_shipping";
  const method = a.input.shipping_method ?? "";
  const cost = isUpgrade ? EXTRA_COST_USD[method as ShippingMethod] - EXTRA_COST_USD[a.current_method as ShippingMethod] : null;
  const Icon = isUpgrade ? Truck : Mail;

  async function decide(approved: boolean, why?: string) {
    setBusy(true);
    await post(`/api/approvals/${a.id}`, { approved, comment: why });
    setBusy(false);
    setCommenting(false);
    onChange();
  }

  const primary = "inline-flex h-8 items-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40";
  const secondary = "inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-600 ring-1 ring-zinc-200">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {a.customer_name} <span className="font-normal text-zinc-500">· {a.order_id}</span>
          </p>
          <p className="text-xs text-zinc-500">
            {isUpgrade ? `Upgrade to ${METHOD_LABELS[method]}${a.status === "pending" && cost ? ` · +$${cost}` : ""}` : "Apology email to the customer"}
          </p>
        </div>
      </div>

      {!isUpgrade && a.input.body && (
        <div className="mt-2">
          <button onClick={() => setShowEmail(!showEmail)} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900">
            <ChevronRight className={`size-3.5 transition-transform ${showEmail ? "rotate-90" : ""}`} />
            {a.status === "pending" ? "Read the draft (not sent yet)" : "Read the email"}
          </button>
          {showEmail && <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-700">{a.input.body}</p>}
        </div>
      )}

      {a.status !== "pending" ? (
        <p className={`mt-2 text-xs font-medium ${a.status === "approved" ? "text-emerald-700" : "text-red-700"}`}>
          {a.status === "approved" ? (isUpgrade ? "Upgraded" : "Sent") : "Declined"}
          {a.comment ? ` · "${a.comment}"` : ""}
        </p>
      ) : commenting ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={isUpgrade ? "What should the agent do instead?" : "What should change in the email?"}
            className="w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-xs outline-none focus:border-zinc-400"
            rows={2}
          />
          <div className="flex gap-2">
            <button disabled={busy || !comment.trim()} onClick={() => decide(false, comment)} className={primary}>
              Send to the agent
            </button>
            <button onClick={() => setCommenting(false)} className="px-2 text-xs text-zinc-500 hover:text-zinc-800">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button disabled={busy} onClick={() => decide(true)} className={primary}>
            {isUpgrade ? `Upgrade${cost ? ` · $${cost}` : ""}` : "Send the email"}
          </button>
          {isUpgrade ? (
            <button disabled={busy} onClick={() => decide(false, "No upgrade. Tell the customer about the delay instead.")} className={secondary}>
              Tell the customer instead
            </button>
          ) : (
            <button disabled={busy} onClick={() => decide(false, "Do not send any email for this order.")} className={secondary}>
              Don&apos;t send
            </button>
          )}
          <button disabled={busy} onClick={() => setCommenting(true)} className={secondary}>
            {isUpgrade ? "Other…" : "Change it…"}
          </button>
        </div>
      )}
    </div>
  );
}
