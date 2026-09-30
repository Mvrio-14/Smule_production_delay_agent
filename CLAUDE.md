# Working rules for this project

Read `PROJECT_BRIEF.md` first. It is the source of truth for scope, scenario, data model, tools and build steps.

## How to work

- Follow the build steps in the brief, in order. Finish a step and check its "done when" before starting the next one. Tell me when a step is done and what you verified.
- Keep it simple. This is a demo for a job application, not a production system. Prefer fewer files, fewer dependencies, plain code.
- Ask before adding a dependency that is not in the stack below.
- Do not add features outside V1. If you see a good extension, note it in `NOTES.md` instead of building it.

## Stack

- Next.js (App Router), TypeScript, strict mode
- Postgres, accessed with a light query layer (plain SQL or Drizzle). No heavy ORM.
- Vercel AI SDK for the agent. Developed on OpenAI; Grok (xAI) can be swapped in. The model comes from the `MODEL` environment variable (`provider:model-id`) so models and providers can be compared.
- Tailwind for the UI. Clean and readable, no design polish beyond that.
- Deployment target: Vercel.

## Environment variables

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `XAI_API_KEY` (optional, only to run Grok)
- `MODEL`

Never commit secrets. Keep an `.env.example` up to date.

## Code rules

- Each agent tool is a typed function with input validation (zod) and a short description the model can read.
- Every agent action is logged to `agent_steps` (tool name, input, output, duration, tokens, cost). The UI and the evals depend on this, so do not skip it.
- The seed must be deterministic. Running it twice gives the same data.
- All integrations are simulated in the database. Do not call Slack, UPS, email or any external service except the model APIs (OpenAI, xAI).
- Keep the system prompt in its own file so it is easy to read and change.

## Style

- UI text and code comments in English.
- Short, clear names. No clever abstractions.

@AGENTS.md
