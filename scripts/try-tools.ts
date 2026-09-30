// Calls each tool on the demo scenario and prints the results. Run: npm run try-tools
// The reschedule tools change order estimates. Run npm run db:reset to go back to the seed.
import { sql } from "@/lib/db";
import { callTool, getOrderContext, rescheduleMachine, rescheduleOrders } from "@/lib/tools";

// The alert, as the production tracking system would send it: an order is behind its plan,
// but nobody has entered why or for how long.
const alert = {
  type: "order_overdue",
  order_id: "SM-10401",
  overdue_minutes: 95,
  detected_at: "2026-10-02T02:10:00-04:00",
};
const alertTime = { now: new Date(alert.detected_at) };
// The supervisor answers at 02:25: "roller jam, back in about 3 hours".
const replyTime = { now: new Date("2026-10-02T02:25:00-04:00") };

function show(title: string, result: unknown) {
  console.log(`\n=== ${title} ===`);
  console.dir(result, { depth: null });
}

show("1. get_order_context", await callTool(getOrderContext, { order_id: alert.order_id }, alertTime));
show("2. reschedule_machine (roller jam, 180 min)", await callTool(rescheduleMachine, { site_id: "amsterdam", machine_id: "laminator-2", delay_minutes: 180, reason: "Roller jam, maintenance on it" }, replyTime));

// Another case, on its own: only one order is delayed (a reprint).
show("3. reschedule_orders (other case: SM-10403 reprint, 240 min)", await callTool(rescheduleOrders, { order_ids: ["SM-10403"], delay_minutes: 240, reason: "Bubbles in laminate, reprint needed" }, replyTime));

// Validation: a negative delay is rejected by zod before touching the database.
try {
  await callTool(rescheduleMachine, { site_id: "amsterdam", machine_id: "laminator-2", delay_minutes: -30, reason: "test" }, replyTime);
} catch (e) {
  show("4. invalid input is rejected", (e as Error).message);
}

await sql.end();
