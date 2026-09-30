// Plays the main scenario end to end with the real model. Run: npm run scenario
// Options: npm run scenario -- --model openai:gpt-6-luna --reply "working on it" --reject
// It resets the database first. Each run costs a few cents of API usage.
import { parseArgs } from "node:util";
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";
import { decideApproval, replyToIncident, startIncident, type AlertEvent } from "@/lib/agent/run";
import { modelSpec } from "@/lib/agent/model";

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    reply: { type: "string", default: "Roller jam on laminator-2, maintenance is on it. Whole machine is down, back in about 3 hours." },
    reject: { type: "boolean", default: false }, // reject the first proposal, to see the agent adapt
  },
});

const alert: AlertEvent = { type: "order_overdue", order_id: "SM-10401", overdue_minutes: 95, detected_at: "2026-10-02T02:10:00-04:00" };
const at = (hhmm: string) => new Date(`2026-10-02T${hhmm}:00-04:00`);

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
console.log(`Model: ${model}\n`);

console.log("02:10  Alert:", JSON.stringify(alert));
const incidentId = await startIncident(alert, { model, now: at("02:10") });
let lastMessage = await printNewMessages(incidentId, 0);
console.log(`  -> status: ${(await status(incidentId)).status}\n`);

console.log(`02:25  Supervisor replies: "${args.reply}"`);
await replyToIncident(incidentId, args.reply, { now: at("02:25") });
lastMessage = await printNewMessages(incidentId, lastMessage);
console.log(`  -> status: ${(await status(incidentId)).status}\n`);

// Support decides on every proposal, one round at a time (the agent may propose again after a rejection).
const times = ["02:40", "02:50", "03:00", "03:10"];
for (let round = 0; round < times.length && (await status(incidentId)).status === "waiting_for_approval"; round++) {
  const pending = await sql`select id, order_id, tool_name, input from approvals where incident_id = ${incidentId} and status = 'pending' order by id`;
  for (const a of pending) {
    const reject = args.reject && round === 0 && a === pending[0];
    console.log(`${times[round]}  Proposal #${a.id}: ${a.tool_name} for ${a.order_id}`);
    if (a.input.shipping_method) console.log(`  method: ${a.input.shipping_method}`);
    console.log(`  note for support: ${a.input.note_for_support}`);
    if (a.input.body) console.log(`  customer email:\n    ${String(a.input.body).replaceAll("\n", "\n    ")}`);
    console.log(`  -> support ${reject ? "REJECTS (comment: too expensive, just tell the customer)" : "approves"}`);
    await decideApproval(a.id, !reject, reject ? "Too expensive for this order, just tell the customer." : undefined, { now: at(times[round]) });
  }
  lastMessage = await printNewMessages(incidentId, lastMessage);
  console.log(`  -> status: ${(await status(incidentId)).status}\n`);
}

const final = await status(incidentId);
console.log(`Final status: ${final.status}`);
console.log(`Summary: ${final.summary}\n`);

const orders = await sql`
  select id, shipping_method, promised_delivery_date, estimated_delivery_date, estimate_reason
  from orders where machine_id = 'laminator-2' and site_id = 'amsterdam' order by id`;
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
