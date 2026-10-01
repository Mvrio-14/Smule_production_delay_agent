// Full state of one incident, polled by the page while the agent works.
import { sql } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/incidents/[id]">) {
  const id = Number((await ctx.params).id);
  const [incident] = await sql`
    select id, order_id, status, model, summary, trigger_event, created_at, resolved_at
    from incidents where id = ${id}`;
  if (!incident) return Response.json({ error: "Unknown incident" }, { status: 404 });

  const [steps, messages, approvals, customerMessages, staff] = await Promise.all([
    sql`select id, kind, tool_name, input, output, is_error, started_at, duration_ms, tokens_in, tokens_out, cost_usd
        from agent_steps where incident_id = ${id} order by started_at, id`,
    sql`select id, sender, recipient, body, sim_time, created_at from messages where incident_id = ${id} order by id`,
    sql`select a.id, a.order_id, a.tool_name, a.input, a.status, a.comment, a.created_at, a.decided_at,
               o.customer_name, o.shipping_method as current_method
        from approvals a join orders o on o.id = a.order_id where a.incident_id = ${id} order by a.id`,
    sql`select id, order_id, body, sent_at from customer_messages where incident_id = ${id} order by id`,
    sql`select id, name, role, chat_handle from staff`,
  ]);
  return Response.json({ incident, steps, messages, approvals, customerMessages, staff });
}
