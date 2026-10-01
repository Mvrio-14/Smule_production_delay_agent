// Step 1 checks: date rules and the demo scenario. Run: npm test
// Resets the database before each test, so each one starts from the seed.
import "@/tests/use-test-schema";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";
import { addWeekdays, shipDateFor } from "@/lib/ship-dates";
import { callTool, getOrderContext, rescheduleMachine, rescheduleOrders } from "@/lib/tools";

const TZ = "America/New_York";
const alertTime = { now: new Date("2026-10-02T02:10:00-04:00") };
const replyTime = { now: new Date("2026-10-02T02:25:00-04:00") };

type Plan = { orders: { order_id: string; status: string; recovery_option?: { shipping_method: string; extra_cost_usd: number } }[] };
const byStatus = (plan: Plan, status: string) => plan.orders.filter((o) => o.status === status).map((o) => o.order_id);

beforeEach(async () => {
  await resetDatabase();
});
after(async () => {
  await sql.end();
});

test("ship date rule: before 17:00 ships same day, after 17:00 or weekend ships next weekday", () => {
  assert.equal(shipDateFor(new Date("2026-10-02T16:59:00-04:00"), TZ), "2026-10-02"); // Friday
  assert.equal(shipDateFor(new Date("2026-10-02T17:05:00-04:00"), TZ), "2026-10-05"); // Friday evening -> Monday
  assert.equal(shipDateFor(new Date("2026-10-03T10:00:00-04:00"), TZ), "2026-10-05"); // Saturday -> Monday
  assert.equal(addWeekdays("2026-10-02", 3), "2026-10-07"); // Friday + 3 business days
});

test("order context: where the order is and who is on shift", async () => {
  const ctx = (await callTool(getOrderContext, { order_id: "SM-10401" }, alertTime)) as {
    production: { machine_id: string; minutes_at_stage: number };
    orders_on_same_machine: unknown[];
    supervisor_on_shift: { id: string };
    buyer: { id: string };
  };
  assert.equal(ctx.production.machine_id, "laminator-2");
  assert.equal(ctx.production.minutes_at_stage, 240); // since 22:10
  assert.equal(ctx.orders_on_same_machine.length, 8);
  assert.equal(ctx.buyer.id, "ams-buyer");
  assert.equal(ctx.supervisor_on_shift.id, "ams-supervisor-3rd"); // night shift started Thursday 22:00
});

test("demo scenario: the 8 orders of the machine, 6 on time, 1 recoverable, 1 late", async () => {
  const plan = (await callTool(rescheduleMachine, { site_id: "amsterdam", machine_id: "laminator-2", delay_minutes: 180, reason: "roller jam" }, replyTime)) as Plan;
  assert.deepEqual(
    plan.orders.map((o) => o.order_id),
    ["SM-10401", "SM-10402", "SM-10403", "SM-10404", "SM-10405", "SM-10406", "SM-10407", "SM-10408"],
  ); // no decoys
  assert.equal(byStatus(plan, "on_time").length, 6);
  assert.deepEqual(byStatus(plan, "late_recoverable"), ["SM-10407"]);
  assert.deepEqual(byStatus(plan, "late"), ["SM-10408"]);
  const recovery = plan.orders.find((o) => o.order_id === "SM-10407")!.recovery_option!;
  assert.equal(recovery.shipping_method, "ups_2nd_day_air"); // the cheapest method that keeps the promise
  assert.equal(recovery.extra_cost_usd, 45);
});

test("delay on some orders only: a 4h reprint on SM-10403, nothing else moves", async () => {
  const plan = (await callTool(rescheduleOrders, { order_ids: ["SM-10403"], delay_minutes: 240, reason: "reprint" }, replyTime)) as Plan;
  assert.deepEqual(byStatus(plan, "late_recoverable"), ["SM-10403"]); // ready 17:15, ships Monday, 2nd Day Air keeps Wednesday
  const [saved] = await sql`select estimated_ship_date from orders where id = 'SM-10403'`;
  assert.equal(saved.estimated_ship_date, "2026-10-05"); // the new plan is saved
  const [other] = await sql`select estimated_ship_date from orders where id = 'SM-10401'`;
  assert.equal(other.estimated_ship_date, "2026-10-02"); // other orders keep their plan
});

test("day scenario: holographic vinyl late, the buyer expects it tomorrow 8:00", async () => {
  const dayReply = { now: new Date("2026-10-01T11:00:00-04:00") };
  const ctx = (await callTool(getOrderContext, { order_id: "SM-10501" }, { now: new Date("2026-10-01T10:40:00-04:00") })) as {
    supervisor_on_shift: { id: string };
  };
  assert.equal(ctx.supervisor_on_shift.id, "ams-supervisor-1st"); // day shift, not Mike
  const plan = (await callTool(
    rescheduleOrders,
    { order_ids: ["SM-10501", "SM-10502", "SM-10503", "SM-10504"], delay_minutes: 1260, reason: "holographic vinyl delivery late" },
    dayReply,
  )) as Plan;
  assert.deepEqual(byStatus(plan, "late_recoverable"), ["SM-10501"]);
  assert.deepEqual(byStatus(plan, "late"), ["SM-10502"]);
  assert.deepEqual(byStatus(plan, "on_time"), ["SM-10503", "SM-10504"]);
});
