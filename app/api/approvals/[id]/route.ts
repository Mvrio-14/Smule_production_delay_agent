// Support approves or rejects a proposal. The agent resumes once every pending proposal is decided.
import { after } from "next/server";
import { z } from "zod";
import { recordDecision, runAgent } from "@/lib/agent/run";

export const maxDuration = 300;

const input = z.object({ approved: z.boolean(), comment: z.string().trim().max(500).optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const id = Number((await ctx.params).id);
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid decision" }, { status: 400 });
  try {
    const decision = await recordDecision(id, parsed.data.approved, parsed.data.comment || undefined);
    if (decision.resume) after(() => runAgent(decision.incidentId, decision.now).catch((e) => console.error(`Incident ${decision.incidentId}:`, e)));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
