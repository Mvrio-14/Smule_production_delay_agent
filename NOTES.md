# Notes

Ideas and extensions spotted during the build. Not in V1.

## To document (README and video)

- Be explicit about what is simulated and would already exist in Sticker Mule's own systems: machine monitoring and overdue detection (production tracking), staff schedule (workforce/scheduling software), estimated date recalculation (production/order system). The agent does not own that logic, it calls it. The value shown is the agent loop, the tool contracts, the human-in-the-loop and the measurement.

## Eval ideas (decide at step 5)

- Vary the cause, not only breakdowns: "2 operators out sick, about 4h behind" must be handled like a breakdown (reschedule_machine with delay_minutes = 240).
- False alarm: "sensor glitch, all running" means no update and no notification; the incident is closed.
- Delay on some orders only ("SM-10403 needs a reprint", "out of holographic vinyl"): the agent must map the reply to the right order ids and pass them to `reschedule_orders`.

## Extensions

- Trust a date the supervisor gives for a specific order ("SM-10407 won't ship before Monday") over the computed one.

## Working assumption (say it in the README and the video)

Proven: support hears about factory delays late (Glassdoor reviews from support staff), and the supervisor job posting makes "communicate production conditions and rush orders to customer service" part of the role. Late deliveries are handled when the customer complains ("contact us so we can help").

Assumed, not proven: during a stop, the expected duration and cause are not entered in the production system reliably. Industry sources (mostly vendors of downtime tracking tools) say manual downtime data is often incomplete.

If Sticker Mule's system already has the expected duration, the agent reads it instead of asking the supervisor; the rest of the loop (decide, notify support, request approval) is unchanged.

Supplier delays were considered as the main use case and rejected for V1: no public evidence of supplier pain at Sticker Mule, most products are made in-house, and an external email loop is slow to demo. Kept as an extension.

## Build vs buy: Grok Bot (evaluated 2026-09-30)

Grok Bot (xAI, beta since 2026-08-11): always-on "bots" with their own cloud computer, one-click connectors (Slack, Notion, Google Drive, GitHub...), computer use for apps without an API, routines triggered by a schedule or events like a new Slack message, "teach a task" by recording your screen, and approval before sensitive work. Bundled with SuperGrok / Cursor subscriptions, enterprise on a waitlist.

Why this agent is built in code instead:
- No model choice (routing is automatic), so no model comparison, which the role asks for ("test new tools and models").
- No built-in audit trail or eval harness; this process needs a trace per step, metrics and scored test cases.
- Permissions are those of the logged-in user, not scoped per tool; touching production plans and customer messages needs narrow, typed tools.
- Its natural trigger is a person or a Slack message; this agent starts from a tracking-system webhook and waits hours for a reply.

Where it fits: the tools here could be exposed as an MCP server or HTTP API, so a Grok Bot (or the Grok voice agent) used by a supervisor or support lead could call `get_order_context` or read incident status. Good for the "extensions" slide and the "adopt what works" part of the role.
