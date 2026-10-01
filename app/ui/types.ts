// Shapes returned by GET /api/incidents/[id], plus small display helpers shared by the UI.

export type Status = "running" | "waiting_for_reply" | "waiting_for_approval" | "resolved" | "failed";

export type IncidentSummary = { id: number; order_id: string; status: Status; model: string; created_at: string };

export type Step = {
  id: number;
  kind: "llm" | "tool";
  tool_name: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  is_error: boolean;
  started_at: string;
  duration_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
};

export type Message = { id: number; sender: string; recipient: string; body: string; sim_time: string; created_at: string };

export type Approval = {
  id: number;
  order_id: string;
  tool_name: "upgrade_shipping" | "message_customer";
  input: { shipping_method?: string; body?: string };
  status: "pending" | "approved" | "rejected";
  comment: string | null;
  created_at: string;
  decided_at: string | null;
  customer_name: string;
  current_method: string;
};

export type CustomerMessage = { id: number; order_id: string; body: string; sent_at: string };

export type Staff = { id: string; name: string; role: string; chat_handle: string };

export type IncidentState = {
  incident: {
    id: number;
    order_id: string;
    status: Status;
    model: string;
    summary: string | null;
    trigger_event: { detected_at: string; order_id: string; stage: string; job_started: boolean; planned_stage_minutes: number; overdue_minutes: number };
    created_at: string;
  };
  steps: Step[];
  messages: Message[];
  approvals: Approval[];
  customerMessages: CustomerMessage[];
  staff: Staff[];
};

export const METHOD_LABELS: Record<string, string> = {
  ups_ground: "UPS Ground",
  ups_2nd_day_air: "UPS 2nd Day Air",
  ups_next_day_air: "UPS Next Day Air",
};

export const STATUS_LABELS: Record<Status, string> = {
  running: "Agent is working",
  waiting_for_reply: "Waiting for the supervisor",
  waiting_for_approval: "Waiting for support",
  resolved: "Resolved",
  failed: "Failed",
};

// Simulated factory time of a real timestamp: alert time + real time elapsed since the incident started.
export function simClock(state: IncidentState, realTime: string): string {
  const { trigger_event, created_at } = state.incident;
  const sim = new Date(new Date(trigger_event.detected_at).getTime() + (new Date(realTime).getTime() - new Date(created_at).getTime()));
  return hhmm(sim.toISOString());
}

export function hhmm(time: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(time));
}

// "2026-10-07" -> "October 7"
export function niceDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

// GET /api/dashboard
export type DashboardRow = {
  id: number;
  order_id: string;
  cause: string | null; // as the agent entered it in the planning system
  status: Status;
  created_at: string;
  duration_min: number | null;
  messages: number;
  tool_calls: number;
  tool_errors: number;
  human_touches: number;
  late_orders: number | null;
  affected_orders: number | null;
  tokens: number;
  cost: number;
};

export type DashboardData = {
  kpis: {
    handled: number;
    successful: number;
    failed: number;
    warned_early: number;
    upgrades: number;
    upgrade_spend: number;
    approval_rate: number | null;
    decided: number;
    avg_minutes_to_support: number | null;
    avg_cost: number | null;
    avg_tokens: number | null;
  };
  incidents: DashboardRow[];
};

// GET /api/evals
export type EvalCaseView = {
  case_id: string;
  risk: string;
  scenario: string;
  run: {
    checks: { name: string; passed: boolean }[];
    script: { replies: string[]; support: string };
    snapshot: IncidentState | null;
    cost_usd: number;
    model: string;
    ran_at: string;
  } | null;
};
