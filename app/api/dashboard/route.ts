// Dashboard data: one row per real incident (scripted test scenarios run elsewhere), plus the headline numbers.
import { sql } from "@/lib/db";
import { EXTRA_COST_USD, type ShippingMethod } from "@/lib/ship-dates";

type PlanOutput = { orders: { status: string }[]; late: number; late_recoverable: number };

export async function GET() {
  const rows = await sql`
    select i.id, i.order_id, i.status, i.created_at, i.sim_resolved_at, i.sim_started_at,
      (select count(*) from messages m where m.incident_id = i.id)::int as messages,
      (select count(*) from agent_steps s where s.incident_id = i.id and s.kind = 'tool')::int as tool_calls,
      (select count(*) from agent_steps s where s.incident_id = i.id and s.is_error)::int as tool_errors,
      ((select count(*) from messages m where m.incident_id = i.id and m.sender <> 'agent')
        + (select count(*) from approvals a where a.incident_id = i.id and a.decided_at is not null))::int as human_touches,
      (select coalesce(sum(tokens_in + tokens_out), 0) from agent_steps s where s.incident_id = i.id)::int as tokens,
      (select coalesce(sum(cost_usd), 0) from agent_steps s where s.incident_id = i.id) as cost,
      (select output from agent_steps s where s.incident_id = i.id and s.tool_name like 'reschedule%' and not s.is_error
        order by started_at desc limit 1) as plan,
      (select min(sim_time) from messages m where m.incident_id = i.id and m.recipient = 'support') as support_at,
      (select input->>'reason' from agent_steps s where s.incident_id = i.id and s.tool_name like 'reschedule%' and not s.is_error
        order by started_at desc limit 1) as cause,
      (select count(*) from approvals a where a.incident_id = i.id and a.status = 'approved')::int as approved,
      (select count(*) from approvals a where a.incident_id = i.id and a.status = 'rejected')::int as rejected,
      (select count(*) from customer_messages c join orders o on o.id = c.order_id
        where c.incident_id = i.id and (i.sim_started_at at time zone 'America/New_York')::date < o.promised_delivery_date)::int as warned_early,
      (select coalesce(json_agg(output), '[]') from agent_steps s
        where s.incident_id = i.id and s.tool_name = 'upgrade_shipping' and not s.is_error) as upgrades
    from incidents i
    order by i.id desc`;

  const incidents = rows.map((r) => {
    const plan = r.plan as PlanOutput | null;
    const upgrades = r.upgrades as { previous_method: ShippingMethod; shipping_method: ShippingMethod }[];
    return {
      id: r.id as number,
      order_id: r.order_id as string,
      cause: (r.cause as string | null) ?? null,
      status: r.status as string,
      created_at: r.created_at as Date,
      // Factory (simulated) time from the alert to the end of the incident.
      duration_min: r.sim_resolved_at ? Math.round((r.sim_resolved_at.getTime() - r.sim_started_at.getTime()) / 60_000) : null,
      messages: r.messages as number,
      tool_calls: r.tool_calls as number,
      tool_errors: r.tool_errors as number,
      human_touches: r.human_touches as number,
      late_orders: plan ? plan.late + plan.late_recoverable : null,
      affected_orders: plan ? plan.orders.length : null,
      tokens: r.tokens as number,
      cost: Number(r.cost),
      minutes_to_support: r.support_at ? Math.round((r.support_at.getTime() - r.sim_started_at.getTime()) / 60_000) : null,
      approved: r.approved as number,
      rejected: r.rejected as number,
      warned_early: r.warned_early as number,
      upgrades: upgrades.length,
      upgrade_spend: upgrades.reduce((sum, u) => sum + EXTRA_COST_USD[u.shipping_method] - EXTRA_COST_USD[u.previous_method], 0),
    };
  });

  const sum = (k: keyof (typeof incidents)[number]) => incidents.reduce((s, i) => s + Number(i[k] ?? 0), 0);
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const withSteps = incidents.filter((i) => i.tokens > 0);
  const decided = sum("approved") + sum("rejected");

  return Response.json({
    kpis: {
      handled: incidents.length,
      successful: incidents.filter((i) => i.status === "resolved").length,
      failed: incidents.filter((i) => i.status === "failed").length,
      warned_early: sum("warned_early"),
      upgrades: sum("upgrades"),
      upgrade_spend: sum("upgrade_spend"),
      approval_rate: decided ? sum("approved") / decided : null,
      decided,
      avg_minutes_to_support: avg(incidents.flatMap((i) => (i.minutes_to_support === null ? [] : [i.minutes_to_support]))),
      avg_cost: avg(withSteps.map((i) => i.cost)),
      avg_tokens: avg(withSteps.map((i) => i.tokens)),
    },
    incidents,
  });
}
