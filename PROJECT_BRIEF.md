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

1. Built on **Grok** (xAI API). Sticker Mule uses Grok company-wide and in its support chat.
2. A **real internal process**, not a customer chatbot. Their support chat (Grok) already exists and cannot contact teams or act on orders.
3. **Observability and measurement** are part of the product, not an afterthought.
4. Delivered as a **video** plus a live deployed app, not only a repository.

## Company context (what we know)

- Sticker Mule prints custom stickers, labels, packaging, apparel. Factories in Amsterdam (NY), Gaffney (SC) and Pisa (Italy).
- Production runs in 3 shifts. Each shift has a production supervisor, with shift leaders below and a factory manager above.
- Typical flow: order, proof (artwork approval), print, laminate, cut, pack, ship (UPS). Standard turnaround is about 4 business days.
- They build almost all software in-house: Go, TypeScript, React, GraphQL, Postgres, GCP. They use Slack and Asana.
- They have had real-time production tracking in-house for years. The agent does not replace tracking. It handles what happens after an alert.
- Evidence of the pain point: a current job posting says the production supervisor must communicate production conditions to customer support. Older employee reviews say the factory was often behind without informing support, and that support was the last to know.

## The agent in one sentence

When the production tracking system reports that an order is stuck at a stage, the agent finds the affected orders and the on-duty supervisor, asks the supervisor for the reason and a new estimate, then updates the order dates and either informs support or asks a human to approve an action.

## The single demo scenario

- Alert: `laminator-2` at the Amsterdam site is overdue during the night shift.
- 8 orders are waiting on that machine.
- After the supervisor answers (for example "roller jam, maintenance on it, back in about 3 hours"), 6 orders still meet their promised ship date and 2 do not.
- Expected agent behavior:
  - update the estimated dates of all 8 orders
  - do not notify anyone for the 6 orders that are still on time
  - for the 2 late orders, notify support with a clear summary and a draft customer message
  - if one late order is a rush order, request human approval for an action (for example upgrade UPS shipping) instead of acting alone

## Trigger event

The agent is triggered by an event that their tracking system would emit (webhook). In the demo, a button sends it.

```json
{
  "type": "stage_overdue",
  "site": "amsterdam",
  "stage": "lamination",
  "machine_id": "laminator-2",
  "overdue_minutes": 95,
  "detected_at": "2026-10-02T02:10:00-04:00"
}
```

## Simulated world (Postgres)

All integrations are simulated. Seed data must be deterministic so the demo and the tests are reproducible.

Tables (adjust names if needed, keep them simple):

- `sites`: id, name, timezone
- `machines`: id, site_id, type (printer, laminator, cutter, packer), name
- `staff`: id, name, role (supervisor, shift_leader, factory_manager, support_agent), site_id, contact_handle
- `shifts`: id, site_id, name (day, evening, night), start_time, end_time, supervisor_id
- `orders`: id, customer_name, product, quantity, site_id, current_stage, machine_id, stage_entered_at, expected_stage_minutes, estimated_ship_date, promised_ship_date, shipping_method, order_type (standard, rush, stores_gift), status
- `incidents`: id, trigger_event (json), status (open, waiting_for_reply, resolved, escalated), created_at, resolved_at
- `messages`: id, incident_id, sender (agent or staff id), channel (chat), body, created_at
- `agent_steps`: id, incident_id, step_index, kind (llm_call, tool_call, decision), tool_name, input (json), output (json), duration_ms, tokens_in, tokens_out, cost_usd, created_at
- `support_notifications`: id, incident_id, order_ids, summary, draft_customer_message, created_at
- `approval_requests`: id, incident_id, order_id, proposed_action, reason, status (pending, approved, rejected), created_at

Seed: about 50 orders across 2 sites and 3 shifts, including the 8 orders on `laminator-2` in Amsterdam, with 2 of them close to their promised date and 1 of those 2 marked `rush`.

## Agent tools

Each tool is a typed TypeScript function. Later they can be exposed as an MCP server so other agents (for example a Grok voice agent) can reuse them.

- `get_orders_by_machine(machine_id)` returns the orders waiting on a machine
- `get_on_duty_supervisor(site_id, at_time)` returns the supervisor of the current shift, with the factory manager as escalation contact
- `send_message(staff_id, body)` posts a message in the simulated chat and puts the incident in `waiting_for_reply`
- `update_order_estimate(order_id, new_estimated_ship_date, reason)`
- `notify_support(order_ids, summary, draft_customer_message)`
- `request_human_approval(order_id, proposed_action, reason)`

## Waiting for a human reply

The agent cannot block for hours. Use two phases:

1. Run until `send_message`, save the conversation state, set the incident to `waiting_for_reply`.
2. When the supervisor replies in the chat, resume the agent with the full history and let it finish.

## Decision rule (only one in V1)

For each affected order, compare the new estimate with the promised ship date.
- Still on time: update the estimate, notify nobody.
- Late: notify support with a summary and a draft customer message.
- Late and `rush`: also request human approval for an action (for example upgrade shipping).
- Supervisor reply unclear: ask one clarifying question before deciding.

## Screens

1. **Dashboard**: "Simulate alert" button, list of incidents, headline metrics.
2. **Incident detail**: agent trace as a timeline on the left (every step with tool, input, output, time, cost), simulated supervisor chat on the right (you type the supervisor replies), support notifications and approval requests at the bottom.
3. **Evals**: run the test cases, show score per case and per model.

## Metrics

- time from alert to support notified (or to resolution when nobody needs to be notified)
- number of human interventions (supervisor replies, approvals)
- orders correctly classified (on time or late)
- cost per incident (tokens and dollars)

## Evals

Five test cases, same trigger, different supervisor replies (pre-written text is fine):

1. Clear reply, all orders still on time
2. Clear reply, 2 orders late, 1 rush (the main demo case)
3. Vague reply ("working on it"), the agent must ask a clarifying question
4. Contradictory reply (new time earlier than now), the agent must question it
5. Minor delay, the agent must not notify support

Automatic scoring per case:
- contacted the right supervisor
- identified the correct set of affected orders
- correct decision for each order (update only, notify, approval)
- no unnecessary notifications

Run the same cases on two Grok models and compare scores and cost. This shows "test new models as they ship".

## Stack

- Next.js (App Router) in TypeScript, one app for UI and API
- Postgres (Neon or Supabase free tier)
- Vercel AI SDK with the xAI provider, model name in an environment variable
- Deployment on Vercel

## Build steps and "done when"

Follow in order. Do not start a step before the previous one meets its "done when".

1. **Data and tools**. Schema, deterministic seed, the six tools. Done when each tool can be called from a script and returns coherent data.
2. **Agent**. System prompt, agent loop with Grok, trigger event, step logging to `agent_steps`. Done when the main scenario runs end to end from a script, with the supervisor reply passed as input.
3. **Wait and resume**. Two-phase run with state saved in the database. Done when the agent stops after messaging, and finishes correctly after a reply is inserted.
4. **UI**. The three screens. Done when the full scenario can be played with the mouse.
5. **Evals and metrics**. Five cases, scoring, model comparison, metrics on the dashboard. Done when all cases run from the Evals screen and show a score.
6. **Deploy and record**. Vercel deployment, then the video.

## Video outline (2 to 3 minutes)

1. The problem, with the evidence (job posting, reviews, their chat cannot act).
2. Live scenario: alert, agent finds orders and supervisor, message, reply, decisions, support notified, approval request.
3. Trace and metrics.
4. Evals and model comparison.
5. "Simulated to real" slide.
6. Extensions.

## Simulated to real (for the final slide)

| In the demo | At Sticker Mule |
|---|---|
| Button sends a JSON event | Webhook from their production tracking system |
| Postgres seed data | Their production and order services (GraphQL, Postgres) |
| Simulated chat | Slack, or SMS / voice for supervisors on the floor |
| Support notifications table | Their support inbox |
| Approval requests table | A Slack approval message or an internal tool |

## Out of scope for V1 (mention as extensions only)

- Phone call to the supervisor when there is no reply (escalation), for example with the Grok Voice Agent Builder reusing the same tools through MCP
- Supplier delays (for example blank t-shirts out of stock), same loop with email as the channel
- Inbound reports: a supervisor reports a problem first and the agent takes it from there
- Concrete actions: moving a job to another site, upgrading UPS shipping automatically within a budget, splitting an order
