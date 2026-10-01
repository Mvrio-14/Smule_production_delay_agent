// Play an incident by hand, one command at a time. Each command is a separate process:
// the agent state lives in the database, not in memory.
//   npm run incident -- start [night|day]          new alert (reset the database first with npm run db:reset)
//   npm run incident -- reply <incident> "<text>"  answer as the supervisor
//   npm run incident -- approve <approval>         approve a proposal
//   npm run incident -- reject <approval> "<why>"  reject a proposal with a comment
//   npm run incident -- show <incident>            chat, proposals, status
// Times use the simulated clock: alert time + real time elapsed.
import { sql } from "@/lib/db";
import { decideApproval, replyToIncident, startIncident } from "@/lib/agent/run";
import { localParts } from "@/lib/ship-dates";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

const [command, id, text] = process.argv.slice(2);

async function show(incidentId: number) {
  const [i] = await sql`select id, status, model, summary from incidents where id = ${incidentId}`;
  if (!i) throw new Error(`Unknown incident ${incidentId}`);
  console.log(`Incident ${i.id} (${i.model}): ${i.status}`);
  const chat = await sql`select sender, recipient, body, sim_time from messages where incident_id = ${incidentId} order by id`;
  for (const m of chat) console.log(`  [${localParts(m.sim_time, "America/New_York").time}] ${m.sender} -> ${m.recipient}: ${m.body}`);
  const proposals = await sql`select id, order_id, tool_name, status, input from approvals where incident_id = ${incidentId} order by id`;
  for (const a of proposals) {
    console.log(`  Proposal ${a.id} [${a.status}] ${a.tool_name} for ${a.order_id}${a.input.shipping_method ? ` -> ${a.input.shipping_method}` : ""}`);
    if (a.input.body) console.log(`    email: ${String(a.input.body).replaceAll("\n", " ")}`);
  }
  if (i.summary) console.log(`  Summary: ${i.summary}`);
}

if (command === "start") {
  const incidentId = await startIncident(SCENARIOS[(id as ScenarioId) ?? "night"]?.alert ?? SCENARIOS.night.alert);
  await show(incidentId);
} else if (command === "reply") {
  await replyToIncident(Number(id), text);
  await show(Number(id));
} else if (command === "approve" || command === "reject") {
  await decideApproval(Number(id), command === "approve", text);
  const [a] = await sql`select incident_id from approvals where id = ${Number(id)}`;
  await show(a.incident_id);
} else if (command === "show") {
  await show(Number(id));
} else {
  console.log("Commands: start | reply <incident> \"text\" | approve <approval> | reject <approval> \"why\" | show <incident>");
}

await sql.end();
