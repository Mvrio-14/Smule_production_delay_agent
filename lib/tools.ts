// Agent tools. Each one is a thin adapter over systems Sticker Mule already has.
// Here every system is simulated in Postgres; the comments say what it would call in real life.
import { z } from "zod";
import { sql } from "@/lib/db";
import {
  EXTRA_COST_USD,
  SHIPPING_METHODS,
  type ShippingMethod,
  deliveryDateFor,
  localParts,
  shipDateFor,
} from "@/lib/ship-dates";

// Set by the agent runtime, never by the model. `now` is the simulated current time.
// `incidentId` is required by the tools that talk to people.
export type ToolContext = { now: Date; incidentId?: number };

function requireIncident(ctx: ToolContext): number {
  if (ctx.incidentId === undefined) throw new Error("This tool can only run inside an incident.");
  return ctx.incidentId;
}

export type Tool<I extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: I;
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
};

// Validates raw input with the tool's zod schema, then runs it.
export async function callTool(tool: Tool, rawInput: unknown, ctx: ToolContext) {
  const input = tool.input.parse(rawInput);
  return tool.run(input, ctx);
}

const orderId = z.string().describe("Order id, for example 'SM-10401'");

// ---------------------------------------------------------------------------
// Order context. Real life: the order service (GraphQL), the production tracking
// system and the scheduling software, combined in one call.
// ---------------------------------------------------------------------------

const getOrderContextInput = z.object({ order_id: orderId });

export const getOrderContext: Tool<typeof getOrderContextInput> = {
  name: "get_order_context",
  description:
    "First call of every incident, for the order in the alert. " +
    "Returns: order (customer, product, shipping method, promised and estimated delivery dates), " +
    "production (site, stage, machine, since when and for how many minutes it has been at this stage), " +
    "orders_on_same_machine (id, customer, product, promised delivery date), machines_at_site (every machine id at this factory, with its stage), " +
    "supervisor_on_shift (null if nobody is on shift), buyer (purchasing, knows supplier deliveries, office hours) " +
    "and escalation_contact (the factory manager). " +
    "Use site_id and machine_id from here when you reschedule, and the staff ids when you write to someone.",
  input: getOrderContextInput,
  run: async ({ order_id }, { now }) => {
    const [o] = await sql`
      select o.*, s.name as site_name, s.timezone
      from orders o join sites s on s.id = o.site_id
      where o.id = ${order_id}`;
    if (!o) throw new Error(`Unknown order ${order_id}. Order ids look like 'SM-10401'.`);

    const machineOrders = await sql`
      select id, customer_name, product, quantity, promised_delivery_date from orders
      where site_id = ${o.site_id} and machine_id = ${o.machine_id}
      order by id`;
    const [shift] = await sql`
      select sa.shift, sa.ends_at, st.id, st.name, st.chat_handle
      from shift_assignments sa join staff st on st.id = sa.supervisor_id
      where sa.site_id = ${o.site_id} and sa.starts_at <= ${now} and sa.ends_at > ${now}`;
    const machines = await sql`
      select distinct machine_id, stage from orders where site_id = ${o.site_id} order by machine_id`;
    const [manager] = await sql`
      select id, name, chat_handle from staff
      where site_id = ${o.site_id} and role = 'factory_manager'`;
    const [buyer] = await sql`
      select id, name, chat_handle from staff
      where site_id = ${o.site_id} and role = 'buyer'`;

    return {
      now_local: localParts(now, o.timezone).label,
      order: {
        id: o.id,
        customer_name: o.customer_name,
        product: `${o.quantity} ${o.product}`,
        shipping_method: o.shipping_method,
        promised_delivery_date: o.promised_delivery_date,
        estimated_delivery_date: o.estimated_delivery_date,
      },
      production: {
        site_id: o.site_id,
        site_name: o.site_name,
        stage: o.stage,
        machine_id: o.machine_id,
        at_stage_since_local: localParts(o.stage_started_at, o.timezone).label,
        minutes_at_stage: Math.round((now.getTime() - o.stage_started_at.getTime()) / 60_000),
      },
      orders_on_same_machine: machineOrders.map((m) => ({
        order_id: m.id,
        customer_name: m.customer_name,
        product: `${m.quantity} ${m.product}`,
        promised_delivery_date: m.promised_delivery_date,
      })),
      supervisor_on_shift: shift
        ? { id: shift.id, name: shift.name, chat_handle: shift.chat_handle, shift: shift.shift, shift_ends_local: localParts(shift.ends_at, o.timezone).label }
        : null,
      machines_at_site: machines.map((m) => ({ machine_id: m.machine_id, stage: m.stage })),
      buyer: buyer ?? null,
      escalation_contact: manager ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Planning system (internal). Real life: the production planning system (MES / APS),
// with carrier transit times from UPS.
// The tracking system detected the delay, but nobody entered how long it lasts or why.
// These tools enter what the supervisor said; the planning system reschedules and returns the new plan.
// ---------------------------------------------------------------------------

const delayMinutes = z
  .number()
  .int()
  .min(0)
  .max(7 * 24 * 60)
  .describe(
    "How many minutes the plan is pushed back, counted from the time of the supervisor's reply. " +
      "'Back in about 3 hours' is 180. 'Back at 1pm' is the minutes from the reply time to 1pm.",
  );
const reason = z.string().min(3).max(300).describe("Cause in a few words, as given by the supervisor, for example 'roller jam'");

type PlannedOrder = {
  id: string;
  customer_name: string;
  product: string;
  quantity: number;
  timezone: string;
  remaining_minutes: number;
  shipping_method: ShippingMethod;
  promised_delivery_date: string;
  estimated_delivery_date: string;
};

// Cheapest faster UPS method that still delivers by the promised date, if any.
function recoveryOption(o: PlannedOrder, shipDate: string) {
  for (const method of SHIPPING_METHODS) {
    const extraCost = EXTRA_COST_USD[method] - EXTRA_COST_USD[o.shipping_method];
    const delivery = deliveryDateFor(shipDate, method);
    if (extraCost > 0 && delivery <= o.promised_delivery_date) {
      return { shipping_method: method, delivery_date: delivery, extra_cost_usd: extraCost };
    }
  }
  return null;
}

// Shared by both reschedule tools: recompute each order's dates, save them, and return the new plan.
async function reschedule(orders: PlannedOrder[], delay: number, why: string, now: Date) {
  const results = orders.map((o) => {
    const readyAt = new Date(now.getTime() + (delay + o.remaining_minutes) * 60_000);
    const shipDate = shipDateFor(readyAt, o.timezone);
    const delivery = deliveryDateFor(shipDate, o.shipping_method);
    const recovery = delivery > o.promised_delivery_date ? recoveryOption(o, shipDate) : null;
    const status = delivery <= o.promised_delivery_date ? "on_time" : recovery ? "late_recoverable" : "late";
    return {
      order_id: o.id,
      customer_name: o.customer_name,
      product: `${o.quantity} ${o.product}`,
      shipping_method: o.shipping_method,
      promised_delivery_date: o.promised_delivery_date,
      previous_delivery_estimate: o.estimated_delivery_date,
      ready_at_local: localParts(readyAt, o.timezone).label,
      new_ship_date: shipDate,
      new_delivery_date: delivery,
      status,
      ...(recovery && { recovery_option: recovery }),
    };
  });

  await sql.begin(async (tx) => {
    for (const r of results) {
      await tx`
        update orders
        set estimated_ship_date = ${r.new_ship_date}, estimated_delivery_date = ${r.new_delivery_date}, estimate_reason = ${why}
        where id = ${r.order_id}`;
    }
  });

  return {
    ups_pickup: "17:00 local time on weekdays",
    on_time: results.filter((r) => r.status === "on_time").length,
    late_recoverable: results.filter((r) => r.status === "late_recoverable").length,
    late: results.filter((r) => r.status === "late").length,
    orders: results,
  };
}

const plannedOrderColumns = sql`
  o.id, o.customer_name, o.product, o.quantity, s.timezone, o.remaining_minutes,
  o.shipping_method, o.promised_delivery_date, o.estimated_delivery_date`;

const rescheduleMachineInput = z.object({
  site_id: z.string().describe("Site id from get_order_context, for example 'amsterdam'"),
  machine_id: z.string().describe("Machine id from get_order_context, for example 'laminator-2'"),
  delay_minutes: delayMinutes,
  reason,
});

export const rescheduleMachine: Tool<typeof rescheduleMachineInput> = {
  name: "reschedule_machine",
  description:
    "Use when the whole machine is stopped or slowed down (breakdown, staffing, maintenance), once the supervisor gave a clear cause and duration. " +
    "Enters the delay in the planning system, which reschedules and saves every order on the machine. " +
    "Returns, per order: customer, product, promised_delivery_date, new_delivery_date and status. " +
    "status is on_time (nothing to do), late_recoverable (a faster UPS method still meets the promise: recovery_option gives the method, " +
    "the new delivery date and the extra cost) or late (nothing can save the promised date).",
  input: rescheduleMachineInput,
  run: async ({ site_id, machine_id, delay_minutes, reason }, { now }) => {
    const orders = await sql<PlannedOrder[]>`
      select ${plannedOrderColumns}
      from orders o join sites s on s.id = o.site_id
      where o.site_id = ${site_id} and o.machine_id = ${machine_id}
      order by o.id`;
    if (orders.length === 0) throw new Error(`No orders on machine ${machine_id} at site ${site_id}. Use the ids returned by get_order_context.`);
    return {
      now_local: localParts(now, orders[0].timezone).label,
      resumes_at_local: localParts(new Date(now.getTime() + delay_minutes * 60_000), orders[0].timezone).label,
      ...(await reschedule(orders, delay_minutes, reason, now)),
    };
  },
};

const rescheduleOrdersInput = z.object({
  order_ids: z.array(orderId).min(1).describe("Ids of the delayed orders, for example ['SM-10403']"),
  delay_minutes: delayMinutes,
  reason,
});

export const rescheduleOrders: Tool<typeof rescheduleOrdersInput> = {
  name: "reschedule_orders",
  description:
    "Use when only some orders are delayed (for example a reprint or a missing material), not the whole machine, " +
    "once the supervisor gave a clear cause and duration and you know which orders. " +
    "Same output as reschedule_machine, for these orders only.",
  input: rescheduleOrdersInput,
  run: async ({ order_ids, delay_minutes, reason }, { now }) => {
    const orders = await sql<PlannedOrder[]>`
      select ${plannedOrderColumns}
      from orders o join sites s on s.id = o.site_id
      where o.id in ${sql(order_ids)}
      order by o.id`;
    const unknown = order_ids.filter((id) => !orders.some((o) => o.id === id));
    return {
      ...(await reschedule(orders, delay_minutes, reason, now)),
      ...(unknown.length > 0 && { unknown_order_ids: unknown }),
    };
  },
};

// ---------------------------------------------------------------------------
// Chat with staff. Real life: Slack (or SMS / voice for supervisors on the floor).
// ---------------------------------------------------------------------------

const messageStaffInput = z.object({
  staff_id: z.string().describe("Staff id from get_order_context, for example 'ams-supervisor-3rd'"),
  body: z.string().min(1).max(600).describe("Short chat message, plain text"),
  expects_reply: z
    .boolean()
    .describe("true when you ask something and must wait for the answer; false for a thank-you or an update that needs no answer"),
});

export const messageStaff: Tool<typeof messageStaffInput> = {
  name: "message_staff",
  description:
    "Send a chat message to a staff member, usually the supervisor on shift. " +
    "With expects_reply true, the run pauses until the reply comes back as the next user message, with the time it was sent. " +
    "With expects_reply false, the run goes on. " +
    "Write it like a quick, polite Slack message from a colleague.",
  input: messageStaffInput,
  run: async ({ staff_id, body }, ctx) => {
    const incidentId = requireIncident(ctx);
    const [person] = await sql`select name, chat_handle from staff where id = ${staff_id}`;
    if (!person) throw new Error(`Unknown staff id ${staff_id}. Use the ids returned by get_order_context.`);
    await sql`
      insert into messages (incident_id, sender, recipient, body, sim_time, created_at)
      values (${incidentId}, 'agent', ${staff_id}, ${body}, ${ctx.now}, ${new Date()})`;
    return { sent_to: `${person.name} (${person.chat_handle})` };
  },
};

// ---------------------------------------------------------------------------
// Support chat. Real life: the support team's Slack channel or inbox.
// ---------------------------------------------------------------------------

const messageSupportInput = z.object({
  headline: z
    .string()
    .min(10)
    .max(100)
    .describe("The problem in one line, for someone who reads nothing else. Example: '2 orders will be late: a laminating machine is down'"),
  details: z
    .string()
    .min(10)
    .max(700)
    .describe(
      "Plain text, no markdown. One or two short sentences on what happened (cause, where, expected delay as people said it, " +
        "no internal calculations). Then one '- ' line per order that needs a decision: customer, reference, new vs promised delivery date, " +
        "what you propose. Orders still on time: just say how many, do not list them.",
    ),
});

export const messageSupport: Tool<typeof messageSupportInput> = {
  name: "message_support",
  description:
    "Post a message in the support team chat, right before your proposals. It is the message support reads: " +
    "the approval buttons for your proposals are shown under it, one per order, so do not ask support to reply in text. " +
    "The run goes on (no reply needed).",
  input: messageSupportInput,
  run: async ({ headline, details }, ctx) => {
    const incidentId = requireIncident(ctx);
    // Stored as one message: the first line is the headline.
    const body = [headline.replaceAll("\n", " "), details].join("\n");
    await sql`
      insert into messages (incident_id, sender, recipient, body, sim_time, created_at)
      values (${incidentId}, 'agent', 'support', ${body}, ${ctx.now}, ${new Date()})`;
    return { posted: true };
  },
};

// ---------------------------------------------------------------------------
// Actions. Both need approval from support before they run (see lib/agent/run.ts).
// ---------------------------------------------------------------------------

const upgradeShippingInput = z.object({
  order_id: orderId,
  shipping_method: z.enum(SHIPPING_METHODS).describe("The shipping_method of recovery_option"),
});

// Real life: the order service and the UPS shipment API.
export const upgradeShipping: Tool<typeof upgradeShippingInput> = {
  name: "upgrade_shipping",
  description:
    "Only for an order returned as late_recoverable: switch it to the faster UPS method given in recovery_option so it still arrives on the promised date. " +
    "It costs money, so support approves it first; the run pauses until they decide. " +
    "Returns the new method and delivery date once approved.",
  input: upgradeShippingInput,
  run: async ({ order_id, shipping_method }) => {
    const [o] = await sql`select estimated_ship_date, promised_delivery_date, shipping_method from orders where id = ${order_id}`;
    if (!o) throw new Error(`Unknown order ${order_id}.`);
    const delivery = deliveryDateFor(o.estimated_ship_date, shipping_method);
    await sql`
      update orders
      set shipping_method = ${shipping_method}, estimated_delivery_date = ${delivery}
      where id = ${order_id}`;
    return {
      order_id,
      previous_method: o.shipping_method,
      shipping_method,
      new_delivery_date: delivery,
      promised_delivery_date: o.promised_delivery_date,
      on_time: delivery <= o.promised_delivery_date,
    };
  },
};

const messageCustomerInput = z.object({
  order_id: orderId,
  body: z
    .string()
    .min(50)
    .max(1200)
    .describe("Warm, short email: apologize, give the new delivery date from the plan, offer help. No internal details (machines, staff names). Signed 'Sticker Mule Support'."),
});

// Real life: an email sent from the support tool.
export const messageCustomer: Tool<typeof messageCustomerInput> = {
  name: "message_customer",
  description:
    "For an order returned as late (or late_recoverable when support refused the upgrade): email the customer before they notice the delay. " +
    "Support reads and approves the email first; the run pauses until they decide.",
  input: messageCustomerInput,
  run: async ({ order_id, body }, ctx) => {
    const incidentId = requireIncident(ctx);
    const [o] = await sql`select id from orders where id = ${order_id}`;
    if (!o) throw new Error(`Unknown order ${order_id}.`);
    await sql`insert into customer_messages (incident_id, order_id, body, sent_at) values (${incidentId}, ${order_id}, ${body}, ${new Date()})`;
    return { order_id, sent: true };
  },
};

export const tools: Tool[] = [
  getOrderContext,
  messageStaff,
  messageSupport,
  rescheduleMachine,
  rescheduleOrders,
  upgradeShipping,
  messageCustomer,
] as Tool[];

// Tools that only run once a human from support approves them.
export const APPROVAL_TOOLS = ["upgrade_shipping", "message_customer"];
