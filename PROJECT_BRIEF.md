# Project brief: Production Delay Agent (Sticker Mule demo)

## Why this project exists

This is a demo built for an application to the **AI Agent Engineer** role at Sticker Mule (global remote). The application form asks: "What agent would you build for Sticker Mule?" This project is the answer, shown as a working product and a short video.

The role description says the engineer will:
- identify where agents can help and build them
- connect agents to third-party and internal tools
- measure results and remove agents that do not deliver
- test new tools and models as they ship

The demo must show these four things, even in simulated form.

## Differentiators (keep these in mind for every decision)

1. **Model-agnostic, Grok-ready**. Developed on OpenAI; the provider is one environment variable. Sticker Mule uses Grok company-wide, so the evals should include a Grok model if an xAI key is available.
2. A **real internal process**, not a customer chatbot. Their support chat (Grok) already exists and cannot contact teams or act on orders.
3. **Observability and measurement** are part of the product, not an afterthought.
4. Delivered as a **video** plus a live deployed app, not only a repository.

## Company context (what we know)

- Sticker Mule prints custom stickers, labels, packaging, apparel. Factories in Amsterdam (NY), Gaffney (SC) and Pisa (Italy).
- Production runs in 3 shifts (1st Mon-Fri 6-14, 2nd Mon-Fri 14-22, 3rd Sun-Thu 22-6). Each shift has a production supervisor, who reports to the factory manager (job postings).
- Production stages print, laminate, cut, pack, then UPS shipping: the usual sticker flow, assumed, not published by Sticker Mule.
- They build almost all software in-house: Go, TypeScript, React, GraphQL, Postgres, GCP. They use Slack and Asana.
- They have had real-time production tracking in-house for years. The agent does not replace tracking. It handles what happens after an alert.
- Evidence of the pain point: the supervisor job posting says the supervisor must communicate production conditions and rush orders to customer service. Employee reviews from support say the factory was often behind without informing support. Their FAQ tells customers with a late order to contact support. See NOTES.md for what is proven and what is assumed.

## The agent in one sentence

When the production tracking system reports that an order is behind its plan and nobody has said why or for how long, the agent asks the supervisor on shift, enters the answer in the planning system, and based on the new plan does nothing, proposes a shipping upgrade, or proposes a message to the customer. Both actions wait for a human from support to approve them.

## Research behind the design

- Tool pattern from public agent benchmarks and demos (tau-bench, OpenAI customer service demo): start from an id, load the context with one `get_..._context` tool, then act.
- Grok Bot (xAI, beta since August 2026) was evaluated as a build-vs-buy option: see NOTES.md.
- Incident agents (SRE / on-call): minimal alert, the agent assembles context, finds the right person, proposes an action with evidence, a human approves.
- Anthropic, "Writing effective tools for agents": few consolidated tools that return meaningful context. "Building effective agents": human checkpoints before actions that cost money.
- The AI SDK has built-in tool approvals (`toolApproval`), used for the shipping upgrade.

## The single demo scenario

- Alert: order SM-10401 is 95 minutes behind its plan (Friday 2026-10-02, 02:10, night shift).
- Context: it is laminating on `laminator-2` in Amsterdam since 23:05. 8 orders depend on that machine (SM-10401 running, 7 queued). Only SM-10401 looks late to the tracking system so far. Mike Kowalski supervises the night shift.
- The agent asks Mike. At 02:25 he answers "roller jam, maintenance on it, back in about 3 hours".
- The agent reschedules the whole machine (180 min). The planning system returns:
  - 6 orders still delivered on time: nobody is bothered
  - SM-10407 ships Monday instead of Friday; by ground it arrives a day late, by UPS 2nd Day Air (+$45) on time: the agent proposes the upgrade, a human approves
  - SM-10408 already ships Next Day Air and slips to Monday; nothing faster exists: the agent proposes a message to the customer, support approves (or edits) it before it is sent

## Trigger event

Working assumption: the tracking system detects that an order is behind its plan, but nobody has entered why or for how long. The agent only starts in that case. If the expected duration is already in the system, there is nothing to ask (see NOTES.md).

The event names what the tracking system observed (an order behind plan), not a late delivery: finding out whether it becomes a late delivery is the agent's job. The `type` field lets other events use the same agent later (material shortage, supervisor report).

In the demo, a button sends it. In real life, a webhook from the tracking system.

```json
{
  "type": "order_overdue",
  "order_id": "SM-10401",
  "overdue_minutes": 95,
  "detected_at": "2026-10-02T02:10:00-04:00"
}
```

## Simulated world (Postgres)

All integrations are simulated. Seed data is deterministic so the demo and the tests are reproducible. Each table stands in for data that Sticker Mule's own systems already hold. Implemented in `db/schema.sql` and `db/seed.ts`.

Step 1 (done):

- `sites`: id, name, timezone. Amsterdam (NY) and Gaffney (SC), both New York time.
- `staff`: id, name, role (production_supervisor, factory_manager, support_agent), site_id (null for support), chat_handle.
- `shift_assignments`: site_id, shift, starts_at, ends_at, supervisor_id. Simulates the scheduling software with dated rows.
- `orders`: id, customer_name, product, quantity, site_id, stage, machine_id, stage_started_at, remaining_minutes, shipping_method, promised_delivery_date, estimated_ship_date, estimated_delivery_date, estimate_reason.
- No `machines` table: a machine is only an id on the order. We never model machine status; the cause and duration come from the supervisor.
- No rush flag: the promise is a delivery date, and a shipping upgrade is proposed for any order it can save. Moving rush orders to the front of the queue is an extension.

Step 2 (done), the agent's own state and trace:

- `incidents`: trigger_event, order_id, status (running, waiting_for_reply, waiting_for_approval, resolved, failed), model, conversation (full model history, saved to pause and resume), summary (the agent's final answer), sim_started_at, created_at, resolved_at
- `messages`: the chat with staff: incident_id, sender, recipient, body, sim_time
- `agent_steps`: one row per model call (`llm`: tokens, cost, text, tool calls) and one per tool execution (`tool`: input, output, error), with started_at (gives the order) and duration_ms
- `approvals`: actions waiting for support: tool_name, frozen input (including note_for_support), AI SDK approval_id, status, support comment, decided_at
- `customer_messages`: simulated outbox, one row per email actually sent

Simulated clock: `now` = alert time + real time elapsed since the incident was created. Scripts and evals pass an explicit time.

Seed: 50 orders. 8 on `laminator-2` in Amsterdam (SM-10401 to SM-10408). Decoys: 3 orders on `laminator-1` in Amsterdam and 2 on `laminator-2` in Gaffney; they must never move.

### Planning rules (simulated planning system and UPS, `lib/ship-dates.ts`)

- remaining_minutes = minutes until ready to ship per the production plan, queue position included. A stop shifts the whole queue.
- ready at = now + delay_minutes + remaining_minutes
- ship date = that day if ready before 17:00 local on a weekday, else the next weekday
- delivery date = ship date + UPS transit (ground 3, 2nd Day Air 2, Next Day Air 1 business days)
- status: `on_time` if delivery date <= promised delivery date; `late_recoverable` if a faster UPS method still meets the promise (cheapest one returned with its extra cost: 2nd Day Air +$45, Next Day Air +$85 versus ground); `late` otherwise
- Simplifications: production time counted continuously (no weekend pause), no holidays.

The model never does date arithmetic. It turns the supervisor reply into `delay_minutes` (how far the plan is pushed back, whatever the cause: breakdown, staffing, material, or 0 for a false alarm); the planning system does the rest.

## Agent tools

Each tool is a typed TypeScript function with a zod schema and a description the model reads. Later they can be exposed as an MCP server so other agents (for example a Grok voice agent) can reuse them. The runtime passes `now` (simulated time) to every tool; the model never sets it.

In the order of the scenario:

1. `get_order_context(order_id)`: customer, product, promised delivery date, site, stage, machine, time at this stage, number of orders on the same machine, supervisor on shift now, factory manager as escalation contact. Real life: order service, tracking system and scheduling software in one call.
2. `message_staff(staff_id, body)`: asks the supervisor, then the agent waits for the reply. Also used for a clarifying question when the reply is vague or contradictory.
3. `reschedule_machine(site_id, machine_id, delay_minutes, reason)`: the whole machine is delayed. Enters the supervisor's delay and cause; the planning system reschedules and saves every order on the machine and returns the new plan (per order: customer, product, new ship and delivery dates, status, recovery option).
   `reschedule_orders(order_ids, delay_minutes, reason)`: same, when only some orders are delayed (reprint, missing material), on any machine.
4. The two actions, both behind human approval (AI SDK `toolApproval`). The approval requests land with the support team, so support learns about the delay before the customer does (the proven pain point):
   - `upgrade_shipping(order_id, shipping_method, note_for_support)`: for a `late_recoverable` order. Runs only once approved.
   - `message_customer(order_id, body, note_for_support)`: for a `late` order, or a recoverable one whose upgrade was denied or not worth it. The agent writes the customer message; it is sent only once approved.
   - `note_for_support` is written by the model for each proposal (max 500 characters): the cause and expected delay as the supervisor gave them, the impact on this order (new vs promised delivery), and why this action. It is what support reads on the approval card.
   - Support answers Approve, or Reject with a comment (for example "offer a 10% discount"); the model reads the comment and may send a revised proposal. Editing the proposal directly (as in LangChain's Agent Inbox) is an extension.
   - This is the standard human-in-the-loop pattern (AI SDK `toolApproval`, OpenAI Agents SDK `needsApproval`, LangGraph `interrupt`): for the model it is an action tool, for the human it is a notification with a proposal.

No `close_incident` tool: the agent's final answer is the incident summary, and the runtime closes the incident when the agent is done.

Reschedule tools change data and return the result, like a GraphQL mutation returns the modified objects. That saves the agent a second call.

Removed after review: `get_orders_by_machine` and `get_on_duty_supervisor` (merged into `get_order_context` or made useless by the reschedule output), `update_order_estimate` (dates belong to the planning system), `get_shipping_options` (the recovery option comes with the new plan), `request_human_approval` (replaced by an approval on the real action), `notify_support` (support is informed through the approval of the customer message).

## Waiting for a human

The agent cannot block for hours. It pauses in two places:

1. After `message_staff`: save the conversation, set the incident to `waiting_for_reply`, resume with the full history when the supervisor answers.
2. Before `upgrade_shipping` or `message_customer` runs: the AI SDK emits an approval request; resume when a human approves or denies.

## Decision rule (V1)

- Supervisor reply vague or contradictory: ask one clarifying question before rescheduling anything.
- `on_time`: nothing to do.
- `late_recoverable`: propose `upgrade_shipping` with the recovery option; a human approves or denies. If denied, treat the order as late.
- `late`: propose `message_customer` with the new delivery date; support approves or edits it.

## Screens

1. **Dashboard**: "Simulate alert" button, list of incidents, headline metrics.
2. **Incident detail**: agent trace as a timeline on the left (every step with tool, input, output, time, cost), simulated supervisor chat on the right (you type the supervisor replies), pending approvals (shipping upgrades, customer messages) at the bottom.
3. **Evals**: run the test cases, show score per case and per model.

## Metrics

- time from alert to support aware (first approval request), or to resolution when nothing needs to be done
- number of human interventions (supervisor replies, approvals)
- orders correctly classified (on time, recoverable, late)
- cost per incident (tokens and dollars)

## Evals

Same trigger, different supervisor replies (pre-written text is fine). Candidate cases, final list decided at step 5 (see NOTES.md):

1. Main case: roller jam, 3 hours (6 on time, 1 recoverable, 1 late)
2. Minor delay: nothing to do, nobody notified
3. Other cause (staffing, about 4 hours): same logic as a breakdown
4. Vague reply ("working on it"): the agent asks a clarifying question
5. Contradictory reply (a time already past): the agent asks
6. False alarm: nothing to do
7. One order only (reprint): `reschedule_orders`, not the whole machine

Automatic scoring per case:
- contacted the right supervisor
- used the right reschedule tool with the right delay
- correct action for each order (nothing, upgrade proposal, customer message)
- no unnecessary message or proposal

Run the same cases on two models (ideally OpenAI vs Grok) and compare scores and cost. This shows "test new models as they ship".

## Stack

- Next.js (App Router) in TypeScript, one app for UI and API
- Postgres on Supabase (transaction pooler)
- Vercel AI SDK with the OpenAI provider (xAI optional), `provider:model-id` in an environment variable. Default `openai:gpt-6.1-sol` ($2 / $10 per million tokens), comparison `openai:gpt-6-luna` ($0.10 / $0.50). The main scenario costs about $0.03 with Sol.
- Deployment on Vercel

## Build steps and "done when"

Follow in order. Do not start a step before the previous one meets its "done when".

1. **Data and tools**. Schema, deterministic seed, the context and reschedule tools. Done when each tool can be called from a script and returns coherent data. Check: `npm run try-tools`, `npm test`.
2. **Agent**. Design and add incidents, messages, agent_steps and approvals, plus `message_staff`, `upgrade_shipping` and `message_customer`. System prompt, agent loop with the model from `MODEL`, trigger event, step logging to `agent_steps`. Done when the main scenario runs end to end from a script, with the supervisor reply passed as input. Status: done (`npm run scenario`).
3. **Wait and resume**. Two pauses with state saved in the database (supervisor reply, approval). Done when the agent stops after messaging, and finishes correctly after a reply and an approval are inserted. Status: done with step 2, since the state is in the database from the start (`npm run incident`, one process per command).
4. **UI**. The three screens. Done when the full scenario can be played with the mouse.
5. **Evals and metrics**. Cases, scoring, model comparison, metrics on the dashboard. Done when all cases run from the Evals screen and show a score.
6. **Deploy and record**. Vercel deployment, then the video.

## Video outline (2 to 3 minutes)

1. The problem, with the evidence (job posting, reviews, their chat cannot act), and the working assumption.
2. Live scenario: alert, context, message to the supervisor, reply, new plan, upgrade approval, customer message approved by support.
3. Trace and metrics.
4. Evals and model comparison.
5. "Simulated to real" slide.
6. Extensions.

## Simulated to real (for the final slide)

| In the demo | At Sticker Mule |
|---|---|
| Button sends a JSON event | Webhook from their production tracking system |
| `get_order_context` over Postgres seed data | Their order service (GraphQL), tracking system and scheduling software |
| Reschedule tools and `lib/ship-dates.ts` | Their production planning system, with UPS transit times |
| Simulated chat | Slack, or SMS / voice for supervisors on the floor |
| Approval in the incident screen | A Slack message with Approve / Deny buttons, or their support inbox |
| Customer messages table | Email to the customer from their support tool |

## Out of scope for V1 (mention as extensions only)

- Phone call to the supervisor when there is no reply (escalation to the factory manager), for example with the Grok Voice Agent Builder reusing the same tools through MCP
- Supplier delays (for example blank t-shirts out of stock, a known issue in the apparel printing industry): same loop, triggered by a stock alert, with email to the supplier
- Inbound reports: a supervisor reports a problem first and the agent takes it from there
- Rush orders moved to the front of the queue (changes the plan of the other orders)
- Other actions: moving a job to another machine or site, splitting an order, upgrading shipping automatically within a budget
