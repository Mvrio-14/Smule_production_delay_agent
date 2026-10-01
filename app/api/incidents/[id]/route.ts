// Full state of one incident, polled by the page while the agent works.
import { loadIncidentState } from "@/lib/incident-state";

export async function GET(_req: Request, ctx: RouteContext<"/api/incidents/[id]">) {
  const state = await loadIncidentState(Number((await ctx.params).id));
  if (!state) return Response.json({ error: "Unknown incident" }, { status: 404 });
  return Response.json(state);
}
