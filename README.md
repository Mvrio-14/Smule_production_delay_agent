# Production Delay Agent

Internal agent demo for Sticker Mule: when production tracking flags an order behind its plan and nobody has said why or for how long, the agent asks the supervisor on shift, enters the answer in the planning system, and for each impacted order does nothing, proposes a shipping upgrade, or proposes a message to the customer. Support approves every action.

See `PROJECT_BRIEF.md` for scope, design and build steps, and `NOTES.md` for assumptions and extensions.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values (Supabase transaction pooler URL, OpenAI key, model).
3. `npm run db:reset` creates the tables and the seed.

## Commands

| Command | What it does |
|---|---|
| `npm run db:reset` | Drops and recreates all tables with the deterministic seed |
| `npm test` | Tool and date checks, no model call (resets the database) |
| `npm run try-tools` | Calls the data tools on the demo scenario, no model call |
| `npm run scenario` | Full scenario with the real model: alert, supervisor reply, support approvals, then trace and cost. Options: `-- --model openai:gpt-6-luna`, `-- --reply "working on it"`, `-- --reject` |
| `npm run incident -- start` | Play an incident by hand, one command at a time: `start`, `reply <incident> "text"`, `approve <approval>`, `reject <approval> "why"`, `show <incident>` |
| `npm run dev` | Web app on http://localhost:3000 (UI comes in step 4) |

## Code map

- `db/schema.sql`, `db/seed.ts`: simulated world (sites, staff, shifts, orders) and agent runtime tables
- `lib/ship-dates.ts`: planning rules (ship date, UPS transit)
- `lib/tools.ts`: the six agent tools, each a thin adapter over a (simulated) system
- `lib/agent/system-prompt.md`: the system prompt
- `lib/agent/run.ts`: agent loop, step logging, pauses for staff replies and support approvals
- `lib/agent/model.ts`: model choice from `MODEL` and token prices
