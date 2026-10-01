// Runs the test scenarios with the real model and prints what passed. Run: npm run evals
// Options: npm run evals -- <case-id> to run one case. Each case resets the database. About $0.05 per case.
import "@/tests/use-test-schema";
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";
import { decideApproval, replyToIncident, startIncident } from "@/lib/agent/run";
import { SCENARIOS } from "@/lib/scenarios";
import { CASES } from "@/evals/cases";
import { loadIncidentState } from "@/lib/incident-state";
import { modelSpec } from "@/lib/agent/model";

// Results go to the app's schema (public), so the app can show the last run of each case.
// The agent itself runs in the "test" schema.
await sql`
  create table if not exists public.eval_runs (
    id        serial primary key,
    case_id   text not null,
    risk      text not null,
    scenario  text not null,
    checks    jsonb not null,  -- [{ name, passed }]
    script    jsonb not null,  -- { replies, support }
    snapshot  jsonb,           -- the incident as the app shows it
    cost_usd  double precision,
    model     text not null,
    ran_at    timestamptz not null default now()
  )`;

const only = process.argv[2];
const cases = only ? CASES.filter((c) => c.id === only) : CASES;
const results: { case: string; passed: string; failed: string; cost: string }[] = [];

for (const c of cases) {
  await resetDatabase();
  let clock = new Date(SCENARIOS[c.scenario].alert.detected_at);
  const next = () => (clock = new Date(clock.getTime() + 15 * 60_000));
  const replies = [...c.replies];
  process.stdout.write(`${c.id} … `);

  let id = 0;
  try {
    id = await startIncident(SCENARIOS[c.scenario].alert, { now: clock });
    // Play the humans until the agent is done (or a safety limit).
    for (let round = 0; round < 8; round++) {
      const [{ status }] = await sql`select status from incidents where id = ${id}`;
      if (status === "waiting_for_reply") {
        await replyToIncident(id, replies.shift() ?? "That's all I know for now.", { now: next() });
      } else if (status === "waiting_for_approval") {
        next();
        const pending = await sql`select id, tool_name, order_id from approvals where incident_id = ${id} and status = 'pending' order by id`;
        for (const a of pending) {
          const d = c.decide?.({ tool_name: a.tool_name, order_id: a.order_id }) ?? { approved: true };
          await decideApproval(a.id, d.approved, d.comment, { now: clock });
        }
      } else break;
    }
  } catch (e) {
    console.log(`agent error: ${(e as Error).message}`);
  }

  const passed: string[] = [];
  const failed: string[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  for (const check of c.checks) {
    const ok = await check.run(id).catch(() => false);
    (ok ? passed : failed).push(check.name);
    checks.push({ name: check.name, passed: ok });
  }
  const [{ cost }] = await sql`select coalesce(sum(cost_usd), 0) as cost from agent_steps where incident_id = ${id}`;
  console.log(failed.length === 0 ? "PASS" : `FAIL (${failed.join("; ")})`);
  const snapshot = id ? await loadIncidentState(id) : null;
  await sql`
    insert into public.eval_runs (case_id, risk, scenario, checks, script, snapshot, cost_usd, model)
    values (${c.id}, ${c.risk}, ${c.scenario}, ${sql.json(checks)},
            ${sql.json({ replies: c.replies, support: c.supportScript ?? "Approves every proposal." })},
            ${snapshot ? sql.json(JSON.parse(JSON.stringify(snapshot))) : null}, ${Number(cost)}, ${modelSpec()})`;
  results.push({ case: c.id, passed: `${passed.length}/${c.checks.length}`, failed: failed.join("; "), cost: `$${Number(cost).toFixed(3)}` });
}

console.log();
console.table(results);
await sql.end();
