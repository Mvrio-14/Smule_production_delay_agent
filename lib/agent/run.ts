// Agent runtime: starts an incident, runs the model loop, logs every step to agent_steps,
// and pauses in two places: after message_staff (wait for the reply) and before an action
// that needs approval (wait for support). The model history is saved in incidents.conversation,
// so a run can resume minutes or hours later.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateText, stepCountIs, tool, type ModelMessage, type StepResult, type ToolApprovalResponse, type ToolSet } from "ai";
import { sql } from "@/lib/db";
import { localParts } from "@/lib/ship-dates";
import { APPROVAL_TOOLS, tools, type ToolContext } from "@/lib/tools";
import { costUsd, getModel, modelSpec } from "@/lib/agent/model";

const SYSTEM_PROMPT = readFileSync(join(process.cwd(), "lib", "agent", "system-prompt.md"), "utf8");
const MAX_STEPS = 15;

// Sent by the production tracking system when an order has spent far longer than planned at a stage.
export type AlertEvent = {
  type: "order_overdue";
  order_id: string;
  stage: string;
  planned_stage_minutes: number; // how long the plan gave this stage
  overdue_minutes: number; // how far past that it is
  detected_at: string;
};

type Incident = {
  id: number;
  order_id: string;
  status: string;
  model: string;
  conversation: ModelMessage[];
  sim_started_at: Date;
  created_at: Date;
};

async function loadIncident(incidentId: number): Promise<Incident> {
  const [incident] = await sql<Incident[]>`select * from incidents where id = ${incidentId}`;
  if (!incident) throw new Error(`Unknown incident ${incidentId}`);
  return incident;
}

// Simulated clock: the alert time plus the real time elapsed since the incident was created.
// Scripts and evals pass an explicit `now` instead.
export function simNow(incident: Pick<Incident, "sim_started_at" | "created_at">): Date {
  return new Date(incident.sim_started_at.getTime() + (Date.now() - incident.created_at.getTime()));
}

async function siteTimezone(orderId: string): Promise<string> {
  const [row] = await sql`select s.timezone from orders o join sites s on s.id = o.site_id where o.id = ${orderId}`;
  return row?.timezone ?? "America/New_York";
}

async function saveConversation(incidentId: number, conversation: ModelMessage[]) {
  await sql`update incidents set conversation = ${sql.json(conversation as never)} where id = ${incidentId}`;
}

// ---------------------------------------------------------------------------
// Entry points: alert, staff reply, support decision.
// ---------------------------------------------------------------------------

// Each entry point exists in two forms: `record...` saves the human input and returns what the agent
// needs to resume (the web app then runs the agent in the background), and a combined form used by scripts.

export async function startIncident(event: AlertEvent, opts: { now?: Date; model?: string } = {}): Promise<number> {
  const { id, now } = await createIncident(event, opts);
  await runAgent(id, now);
  return id;
}

export async function createIncident(event: AlertEvent, opts: { now?: Date; model?: string } = {}) {
  const spec = opts.model ?? modelSpec();
  const now = opts.now ?? new Date(event.detected_at);
  const timezone = await siteTimezone(event.order_id);
  const conversation: ModelMessage[] = [
    {
      role: "user",
      content: `New alert from the production tracking system, received at ${localParts(now, timezone).label} (local time):\n${JSON.stringify(event, null, 2)}`,
    },
  ];
  const [{ id }] = await sql`
    insert into incidents (trigger_event, order_id, status, model, conversation, sim_started_at, created_at)
    values (${sql.json(event)}, ${event.order_id}, 'running', ${spec}, ${sql.json(conversation as never)}, ${event.detected_at}, ${new Date()})
    returning id`;
  return { id: id as number, now };
}

export async function replyToIncident(incidentId: number, body: string, opts: { now?: Date } = {}) {
  const now = await recordReply(incidentId, body, opts);
  await runAgent(incidentId, now);
}

export async function recordReply(incidentId: number, body: string, opts: { now?: Date } = {}): Promise<Date> {
  const incident = await loadIncident(incidentId);
  if (incident.status !== "waiting_for_reply") throw new Error(`Incident ${incidentId} is not waiting for a reply (status: ${incident.status}).`);
  const now = opts.now ?? simNow(incident);

  // The reply comes from the last person the agent wrote to.
  const [last] = await sql`
    select m.recipient, s.name from messages m join staff s on s.id = m.recipient
    where m.incident_id = ${incidentId} and m.sender = 'agent'
    order by m.id desc limit 1`;
  await sql`
    insert into messages (incident_id, sender, recipient, body, sim_time, created_at)
    values (${incidentId}, ${last.recipient}, 'agent', ${body}, ${now}, ${new Date()})`;

  const timezone = await siteTimezone(incident.order_id);
  const conversation: ModelMessage[] = [
    ...incident.conversation,
    { role: "user", content: `Reply from ${last.name} (${last.recipient}) at ${localParts(now, timezone).label} (local time):\n"${body}"` },
  ];
  await saveConversation(incidentId, conversation);
  return now;
}

// Records a support decision. The agent resumes once every pending approval of the incident is decided.
export async function decideApproval(approvalRowId: number, approved: boolean, comment?: string, opts: { now?: Date } = {}) {
  const decision = await recordDecision(approvalRowId, approved, comment, opts);
  if (decision.resume) await runAgent(decision.incidentId, decision.now);
}

// Returns resume: true once the last pending approval of the incident is decided.
export async function recordDecision(approvalRowId: number, approved: boolean, comment?: string, opts: { now?: Date } = {}) {
  const [approval] = await sql`
    update approvals set status = ${approved ? "approved" : "rejected"}, comment = ${comment ?? null}, decided_at = ${new Date()}
    where id = ${approvalRowId} and status = 'pending'
    returning incident_id`;
  if (!approval) throw new Error(`Approval ${approvalRowId} is unknown or already decided.`);
  const incidentId: number = approval.incident_id;

  const [{ pending }] = await sql`select count(*)::int as pending from approvals where incident_id = ${incidentId} and status = 'pending'`;
  if (pending > 0) return { incidentId, resume: false, now: new Date() };

  // Send back every decision the model has not seen yet.
  const incident = await loadIncident(incidentId);
  const answered = new Set(
    incident.conversation.flatMap((m) =>
      m.role === "tool" ? m.content.flatMap((p) => (p.type === "tool-approval-response" ? [p.approvalId] : [])) : [],
    ),
  );
  const decided = await sql`select approval_id, status, comment from approvals where incident_id = ${incidentId} and status <> 'pending'`;
  const responses: ToolApprovalResponse[] = decided
    .filter((a) => !answered.has(a.approval_id))
    .map((a) => ({
      type: "tool-approval-response",
      approvalId: a.approval_id,
      approved: a.status === "approved",
      ...(a.comment && { reason: `Support comment: ${a.comment}` }),
    }));

  const conversation: ModelMessage[] = [...incident.conversation, { role: "tool", content: responses }];
  await saveConversation(incidentId, conversation);
  return { incidentId, resume: true, now: opts.now ?? simNow(incident) };
}

// ---------------------------------------------------------------------------
// The model loop, with step logging.
// ---------------------------------------------------------------------------

// True when the step sent a message to staff and asked for an answer: the run must pause there.
function asksStaff(step: StepResult<ToolSet> | undefined): boolean {
  return !!step?.toolCalls.some((c) => c.toolName === "message_staff" && (c.input as { expects_reply?: boolean }).expects_reply);
}

async function logStep(incidentId: number, row: {
  kind: "llm" | "tool";
  tool_name?: string;
  input?: unknown;
  output?: unknown;
  is_error?: boolean;
  started_at: Date;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number | null;
  model?: string;
}) {
  await sql`
    insert into agent_steps (incident_id, kind, tool_name, input, output, is_error, started_at, duration_ms, tokens_in, tokens_out, cost_usd, model)
    values (${incidentId}, ${row.kind}, ${row.tool_name ?? null}, ${row.input === undefined ? null : sql.json(row.input as never)},
            ${row.output === undefined ? null : sql.json(row.output as never)}, ${row.is_error ?? false}, ${row.started_at},
            ${row.duration_ms}, ${row.tokens_in ?? null}, ${row.tokens_out ?? null}, ${row.cost_usd ?? null}, ${row.model ?? null})`;
}

export async function runAgent(incidentId: number, now: Date) {
  const incident = await loadIncident(incidentId);
  await sql`update incidents set status = 'running' where id = ${incidentId}`;
  const ctx: ToolContext = { now, incidentId };

  // Timing of the current step: the model call ends when the first tool starts.
  let stepStartedAt = new Date();
  let firstToolAt: Date | undefined;

  // Our tools, wrapped for the AI SDK: same schema and description, plus a trace row per execution.
  const aiTools: ToolSet = Object.fromEntries(
    tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.input,
        execute: async (input: unknown) => {
          const startedAt = new Date();
          firstToolAt ??= startedAt;
          console.log(`[incident ${incidentId}] tool ${t.name} start`);
          try {
            const output = await t.run(input, ctx);
            await logStep(incidentId, { kind: "tool", tool_name: t.name, input, output, started_at: startedAt, duration_ms: Date.now() - startedAt.getTime() });
            console.log(`[incident ${incidentId}] tool ${t.name} done`);
            return output;
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await logStep(incidentId, { kind: "tool", tool_name: t.name, input, output: { error: message }, is_error: true, started_at: startedAt, duration_ms: Date.now() - startedAt.getTime() });
            throw e;
          }
        },
      }),
    ]),
  );

  try {
    const result = await generateText({
      model: getModel(incident.model),
      system: SYSTEM_PROMPT,
      messages: incident.conversation,
      tools: aiTools,
      // OpenAI only: medium reasoning, plus a summary of it to show in the trace. The portable `reasoning`
      // setting of the AI SDK is ignored by OpenAI when tools are present, so it is set here instead.
      providerOptions: { openai: { reasoningEffort: "medium", reasoningSummary: "detailed" } },
      toolApproval: Object.fromEntries(APPROVAL_TOOLS.map((name) => [name, "user-approval" as const])),
      stopWhen: [stepCountIs(MAX_STEPS), ({ steps }) => asksStaff(steps.at(-1))],
      onStepStart: () => {
        console.log(`[incident ${incidentId}] model call start`);
        stepStartedAt = new Date();
        firstToolAt = undefined;
      },
      onStepEnd: async (step) => {
        console.log(`[incident ${incidentId}] model call done: ${step.toolCalls.map((c) => c.toolName).join(", ") || "text"}`);
        const tokensIn = step.usage.inputTokens ?? 0;
        const tokensOut = step.usage.outputTokens ?? 0;
        await logStep(incidentId, {
          kind: "llm",
          output: {
            text: step.text || undefined,
            reasoning: step.reasoningText?.slice(0, 2000) || undefined,
            tool_calls: step.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
            finish_reason: step.finishReason,
          },
          started_at: stepStartedAt,
          duration_ms: (firstToolAt ?? new Date()).getTime() - stepStartedAt.getTime(),
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd(incident.model, tokensIn, tokensOut),
          model: incident.model,
        });
      },
    });

    console.log(`[incident ${incidentId}] run finished, saving status`);
    const conversation = [...incident.conversation, ...result.responseMessages];
    const approvalRequests = result.content.filter((p) => p.type === "tool-approval-request");

    if (approvalRequests.length > 0) {
      for (const r of approvalRequests) {
        const input = r.toolCall.input as { order_id: string };
        await sql`
          insert into approvals (incident_id, order_id, tool_name, input, approval_id, created_at)
          values (${incidentId}, ${input.order_id}, ${r.toolCall.toolName}, ${sql.json(input as never)}, ${r.approvalId}, ${new Date()})`;
      }
      await sql`update incidents set status = 'waiting_for_approval', conversation = ${sql.json(conversation as never)} where id = ${incidentId}`;
    } else if (asksStaff(result.steps.at(-1))) {
      await sql`update incidents set status = 'waiting_for_reply', conversation = ${sql.json(conversation as never)} where id = ${incidentId}`;
    } else {
      await sql`
        update incidents set status = 'resolved', summary = ${result.text}, resolved_at = ${new Date()}, conversation = ${sql.json(conversation as never)}
        where id = ${incidentId}`;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sql`update incidents set status = 'failed', summary = ${`Agent error: ${message}`} where id = ${incidentId}`;
    throw e;
  }
}
