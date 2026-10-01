// Step 2 checks for the tools that talk to people and act on orders, without calling the model. Run: npm test
import "@/tests/use-test-schema";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";
import { callTool, messageCustomer, messageStaff, rescheduleMachine, upgradeShipping } from "@/lib/tools";

const replyTime = new Date("2026-10-02T02:25:00-04:00");
let ctx: { now: Date; incidentId: number };

beforeEach(async () => {
  await resetDatabase();
  const [{ id }] = await sql`
    insert into incidents (trigger_event, order_id, status, model, sim_started_at)
    values ('{}', 'SM-10401', 'running', 'test', '2026-10-02T02:10:00-04:00') returning id`;
  ctx = { now: replyTime, incidentId: id };
});
after(async () => {
  await sql.end();
});

test("message_staff posts in the incident chat", async () => {
  await callTool(messageStaff, { staff_id: "ams-supervisor-3rd", body: "What is the cause?", expects_reply: true }, ctx);
  const rows = await sql`select sender, recipient, body from messages where incident_id = ${ctx.incidentId}`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ sender: "agent", recipient: "ams-supervisor-3rd", body: "What is the cause?" }]);
});

test("upgrade_shipping brings a late_recoverable order back on time", async () => {
  await callTool(rescheduleMachine, { site_id: "amsterdam", machine_id: "laminator-2", delay_minutes: 180, reason: "roller jam" }, ctx);
  const result = (await callTool(
    upgradeShipping,
    { order_id: "SM-10407", shipping_method: "ups_2nd_day_air" },
    ctx,
  )) as { on_time: boolean; new_delivery_date: string };
  assert.equal(result.on_time, true);
  assert.equal(result.new_delivery_date, "2026-10-07");
});

test("message_customer writes to the outbox, and a too short email is rejected", async () => {
  const body = "Hi Harbor Books, we're sorry, your order is delayed in production. New expected delivery: October 6. Sticker Mule Support";
  await callTool(messageCustomer, { order_id: "SM-10408", body }, ctx);
  const [sent] = await sql`select order_id from customer_messages where incident_id = ${ctx.incidentId}`;
  assert.equal(sent.order_id, "SM-10408");
  await assert.rejects(callTool(messageCustomer, { order_id: "SM-10408", body: "Sorry, late." }, ctx));
});
