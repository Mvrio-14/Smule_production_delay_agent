// Plays a demo scenario end to end with the real model. Run: npm run scenario
// Options: --scenario night|day, --model openai:gpt-6-luna, --reply "<supervisor reply>",
//          --buyer-reply "<buyer reply>", --no-date (the buyer has no date), --reject (reject the first proposal)
// It resets the database first. Each run costs a few cents of API usage.
import "@/tests/use-test-schema";
import { parseArgs } from "node:util";
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";
import { decideApproval, replyToIncident, startIncident } from "@/lib/agent/run";
import { modelSpec } from "@/lib/agent/model";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";
import { localParts } from "@/lib/ship-dates";

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string", default: "night" },
    model: { type: "string" },
    reply: { type: "string" },
    "buyer-reply": { type: "string" },
    "no-date": { type: "boolean", default: false },
    reject: { type: "boolean", default: false },
  },
});

const scenario = SCENARIOS[args.scenario as ScenarioId];
if (!scenario) throw new Error(`Unknown scenario ${args.scenario}. Use night or day.`);
const alert = scenario.alert;

const DEFAULT_REPLIES: Record<ScenarioId, string> = {
  night: "Roller jam on laminator-2, maintenance is on it. Whole machine is down, back in about 3 hours.",
  day: "The holographic vinyl delivery that was due this morning hasn't arrived, so we can't print the holographic orders. Everything else on printer-1 is running.",
};
const supervisorReplies = [args.reply ?? DEFAULT_REPLIES[args.scenario as ScenarioId], "That's all I know for now, sorry."];
const buyerReply =
  args["buyer-reply"] ??
  (args["no-date"] ? "I've asked the supplier but they haven't answered yet. I don't have a new date for now." : "Just spoke to the supplier: the truck will be here tomorrow at 8am.");

// Simulated clock: each human step happens 15 minutes after the previous one.
let clock = new Date(alert.detected_at);
const next = () => (clock = new Date(clock.getTime() + 15 * 60_000));
const hhmm = (d: Date) => localParts(d, "America/New_York").time;

async function status(incidentId: number) {
  const [i] = await sql`select status, summary from incidents where id = ${incidentId}`;
  return i as { status: string; summary: string | null };
}

async function printNewMessages(incidentId: number, afterId: number) {
  const rows = await sql`select id, sender, recipient, body from messages where incident_id = ${incidentId} and id > ${afterId} order by id`;
  for (const m of rows) console.log(`  [chat] ${m.sender} -> ${m.recipient}: ${m.body}`);
  return rows.at(-1)?.id ?? afterId;
}

await resetDatabase();
const model = args.model ?? modelSpec();
console.log(`Scenario: ${scenario.label} · Model: ${model}
`);

console.log(`${hhmm(clock)}  Alert:`, JSON.stringify(alert));
const incidentId = await startIncident(alert, { model, now: clock });
let lastMessage = await printNewMessages(incidentId, 0);
console.log(`  -> status: ${(await status(incidentId)).status}
`);

// Staff answer, one reply per question: the buyer when the agent wrote to the buyer, otherwise the supervisor.
for (let round = 0; round < 4 && (await status(incidentId)).status === "waiting_for_reply"; round++) {
  const [last] = await sql`
    select s.role from messages m join staff s on s.id = m.recipient
    where m.incident_id = ${incidentId} and m.sender = 'agent' order by m.id desc limit 1`;
  const body = last.role === "buyer" ? buyerReply : (supervisorReplies.shift() ?? "No more information.");
  console.log(`${hhmm(next())}  ${last.role === "buyer" ? "Buyer" : "Supervisor"} replies: "${body}"`);
  await replyToIncident(incidentId, body, { now: clock });
  lastMessage = await printNewMessages(incidentId, lastMessage);
  console.log(`  -> status: ${(await status(incidentId)).status}
`);
}

// Support decides on every proposal, one round at a time (the agent may propose again after a rejection).
for (let round = 0; round < 4 && (await status(incidentId)).status === "waiting_for_approval"; round++) {
  next();
  const pending = await sql`select id, order_id, tool_name, input from approvals where incident_id = ${incidentId} and status = 'pending' order by id`;
  for (const a of pending) {
    const reject = args.reject && round === 0 && a === pending[0];
    console.log(`${hhmm(clock)}  Proposal #${a.id}: ${a.tool_name} for ${a.order_id}`);
    if (a.input.shipping_method) console.log(`  method: ${a.input.shipping_method}`);
    if (a.input.body) console.log(`  customer email:\n    ${String(a.input.body).replaceAll("\n", "\n    ")}`);
    console.log(`  -> support ${reject ? "REJECTS (comment: too expensive, just tell the customer)" : "approves"}`);
    await decideApproval(a.id, !reject, reject ? "Too expensive for this order, just tell the customer." : undefined, { now: clock });
  }
  lastMessage = await printNewMessages(incidentId, lastMessage);
  console.log(`  -> status: ${(await status(incidentId)).status}\n`);
}

const final = await status(incidentId);
console.log(`Final status: ${final.status}`);
console.log(`Summary: ${final.summary}\n`);

const orders = await sql`
  select id, shipping_method, promised_delivery_date, estimated_delivery_date, estimate_reason
  from orders where (site_id, machine_id) = (select site_id, machine_id from orders where id = ${alert.order_id}) order by id`;
console.table(orders.map((o) => ({ order: o.id, method: o.shipping_method, promised: o.promised_delivery_date, estimated: o.estimated_delivery_date, on_time: o.estimated_delivery_date <= o.promised_delivery_date })));

const sent = await sql`select order_id, body from customer_messages where incident_id = ${incidentId}`;
console.log(`Customer emails sent: ${sent.length}`);
for (const m of sent) console.log(`  ${m.order_id}:\n    ${String(m.body).replaceAll("\n", "\n    ")}`);

const steps = await sql`
  select kind, tool_name, duration_ms, tokens_in, tokens_out, cost_usd, is_error, output
  from agent_steps where incident_id = ${incidentId} order by started_at, id`;
console.log("\nTrace:");
console.table(steps.map((s) => ({
  kind: s.kind,
  what: s.kind === "tool" ? s.tool_name : (s.output?.tool_calls ?? []).map((c: { tool: string }) => c.tool).join(", ") || "(text)",
  ms: s.duration_ms,
  tokens: s.kind === "llm" ? `${s.tokens_in} / ${s.tokens_out}` : "",
  cost: s.cost_usd === null ? "" : `$${s.cost_usd.toFixed(4)}`,
  error: s.is_error ? "yes" : "",
})));
const [totals] = await sql`
  select sum(tokens_in)::int as tokens_in, sum(tokens_out)::int as tokens_out, sum(cost_usd) as cost
  from agent_steps where incident_id = ${incidentId}`;
console.log(`Total: ${totals.tokens_in} tokens in, ${totals.tokens_out} tokens out, $${Number(totals.cost ?? 0).toFixed(4)}`);

await sql.end();
