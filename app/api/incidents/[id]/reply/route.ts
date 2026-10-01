// The supervisor answers in the chat. The agent resumes in the background.
import { after } from "next/server";
import { z } from "zod";
import { recordReply, runAgent } from "@/lib/agent/run";

export const maxDuration = 300;

const input = z.object({ body: z.string().trim().min(1).max(1000) });

export async function POST(req: Request, ctx: RouteContext<"/api/incidents/[id]/reply">) {
  const id = Number((await ctx.params).id);
  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Empty message" }, { status: 400 });
  try {
    const now = await recordReply(id, parsed.data.body);
    after(() => runAgent(id, now).catch((e) => console.error(`Incident ${id}:`, e)));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
