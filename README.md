# Late Order Coordinator

An AI agent that coordinates production, support and customers when an order runs late at a Sticker Mule factory. Built as a prototype for the AI Agent Engineer application.

**[Live demo](https://production-delay-agent-smule.vercel.app)** · **Video (2 min):** _coming soon_

![Agent mule](public/agent-mule.svg)

## The problem

When an order falls behind in production, a lot of people need the same information: the supervisor knows the cause, purchasing knows when the material arrives, support needs to know which orders will be late, and the customer wants a date. Today this is usually done by hand, through messages and follow-ups, while the clock runs.

The agent handles that back and forth, so late orders are handled in minutes and saved when possible.

## How it works

1. **Alert.** Production tracking flags an order that is taking much longer than planned at a stage (for example, stuck at laminating).
2. **Ask.** The agent looks up the order and who is on shift, then asks the supervisor for the cause and the expected delay. If a material delivery is missing, it asks the buyer instead.
3. **Plan.** It enters the delay in the planning system, which recalculates ship and delivery dates for every affected order (same machine, or the specific orders named).
4. **Brief support.** It sends support one short summary: the cause, the orders that will be late, and what it suggests for each.
5. **Act, with approval.** For each late order, it proposes a shipping upgrade (if that saves the date) or an email to the customer. Support approves or rejects each action, and the agent carries it out.

The agent pauses whenever it waits for a person (a staff reply or a support decision) and resumes when the answer comes in.

## What you can try in the demo

- **Incidents:** trigger one of two alerts (an order stuck at laminating at night, or an order not started at printing during the day). Answer as the supervisor or the buyer in the chat windows, then approve or reject the proposals as support. The center panel shows each step of the agent: what it said, which tool it called, and the result.
- **Dashboard:** headline numbers across real incidents (time to brief support, customers warned before their date, orders saved by an upgrade, support approval rate, cost per incident) and one row per incident.
- **Test scenarios:** seven scripted cases tied to business risks, with the checks and the full trace of their last run. Read-only.

The demo is shared, so other people's incidents appear too. Alerts are capped per hour.

## Agent design

| Tool | What it does | Needs approval |
|---|---|---|
| `get_order_context` | Order, production status, other orders on the same machine, who is on shift, buyer, escalation contact | |
| `message_staff` | Message a supervisor, buyer or manager, optionally waiting for a reply | |
| `reschedule_machine` | Delay a whole machine; returns the new dates of every order on it | |
| `reschedule_orders` | Delay specific orders (a reprint, a missing material) | |
| `message_support` | Send support the summary of the incident | |
| `upgrade_shipping` | Switch an order to a faster UPS service | Yes |
| `message_customer` | Email the customer about a new date | Yes |

- **Prompt:** [`lib/agent/system-prompt.md`](lib/agent/system-prompt.md). Persona, objective, environment, flow, rules (no invented facts, no guessed dates), escalation and tone.
- **Guardrails:** every tool validates its input (zod). Actions that reach a customer or cost money need support's approval. The factory manager is contacted only when nobody is on shift or in an emergency.
- **Logging:** every step is stored in `agent_steps` (tool, input, output, duration, tokens, cost). The UI, the dashboard and the evals all read from it.
- **Model:** set with `MODEL` (`provider:model-id`). Developed on OpenAI, Grok (xAI) can be swapped in. About $0.05 per incident.

## Evaluation

Seven scripted scenarios ([`evals/cases.ts`](evals/cases.ts)), each tied to a business risk:

| Scenario | Risk |
|---|---|
| Minor delay | Alert fatigue: bothering support and customers for nothing |
| One order to reprint | Precision: moving orders that are fine |
| Absurd duration | Data integrity: a typo would move every date |
| Pushy supervisor | Money spent without control (instruction injection) |
| Asked to blame UPS | Reputation: lying to customers |
| Support declines the email | Respecting the human decision, no nagging |
| Reply in Italian | Several sites and languages (Sticker Mule has a factory in Pisa) |

Each scenario plays the humans from a script, then runs code checks on the stored trace (for example, "no email sent without approval"). No LLM judge. Results are saved and shown in the app.

## Assumptions and limits

- **Everything is simulated.** Orders, planning, shifts, chat, email and UPS live in one Postgres database. No real service is called except the model API.
- **Process assumptions.** The production stages, the shift pattern and the roles come from Sticker Mule's public job postings. I assumed the cause and the length of a stop are not already entered in a system.
- **Simplified planning.** Ship date and UPS transit times follow simple rules (cut-off at 17:00, business days only).
- **Demo-grade.** Security, cost control, tests and the agent harness are kept simple. No authentication.

## Run it locally

Requirements: Node.js 20+, a Postgres database (the demo uses Supabase), an OpenAI API key.

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL, OPENAI_API_KEY, MODEL
npm run db:reset             # creates the tables and the deterministic seed
npm run dev                  # http://localhost:3000
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Tool and planning checks, no model call |
| `npm run evals` | Runs the seven test scenarios with the real model (about $0.05 each) |
| `npm run scenario` | Plays a full incident in the terminal: alert, replies, approvals, trace and cost |
| `npm run incident -- start` | Plays an incident by hand, one command at a time |

Tests and evals run in a separate `test` schema, so they don't touch the demo data.

## Project structure

```
app/                 Next.js pages, API routes and UI components
db/                  schema.sql and the deterministic seed
lib/tools.ts         the seven agent tools
lib/ship-dates.ts    planning rules (ship date, UPS transit)
lib/agent/           agent loop, model choice, system prompt
lib/scenarios.ts     the two demo alerts
evals/               the test scenarios and their checks
scripts/             command line tools (db reset, scenario, evals)
tests/               tests without model calls
```

## Stack

Next.js (App Router), TypeScript, Tailwind, Vercel AI SDK, Postgres (Supabase), deployed on Vercel.
