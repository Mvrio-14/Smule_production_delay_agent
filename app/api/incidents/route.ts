// List incidents, or simulate a new alert from the production tracking system.
import { after } from "next/server";
import { sql } from "@/lib/db";
import { resetOrders } from "@/db/seed";
import { createIncident, runAgent } from "@/lib/agent/run";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

export const maxDuration = 300;


export async function GET() {
  const incidents = await sql`select id, order_id, status, model, created_at from incidents order by id desc limit 50`;
  return Response.json(incidents);
}

// Body: { scenario: "night" | "day" }. Defaults to the night scenario.
export async function POST(req: Request) {
  const { scenario = "night" } = await req.json().catch(() => ({}));
  const chosen = SCENARIOS[scenario as ScenarioId];
  if (!chosen) return Response.json({ error: "Unknown scenario" }, { status: 400 });
  await resetOrders(); // every alert starts from the same factory state; past incidents are kept
  const { id, now } = await createIncident(chosen.alert);
  after(() => runAgent(id, now).catch((e) => console.error(`Incident ${id}:`, e)));
  return Response.json({ id });
}
