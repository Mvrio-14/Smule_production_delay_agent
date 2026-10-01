// The last run of each scripted test scenario (written by npm run evals).
import { sql } from "@/lib/db";
import { CASES } from "@/evals/cases";

export async function GET() {
  const runs = await sql`
    select distinct on (case_id) case_id, risk, scenario, checks, script, snapshot, cost_usd, model, ran_at
    from public.eval_runs order by case_id, ran_at desc`.catch(() => []); // no table yet: nothing has run
  // In the order of the cases file, including cases that never ran.
  return Response.json(
    CASES.map((c) => ({ case_id: c.id, risk: c.risk, scenario: c.scenario, run: runs.find((r) => r.case_id === c.id) ?? null })),
  );
}
