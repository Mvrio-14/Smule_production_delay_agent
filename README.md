# Production Delay Agent

Internal agent demo for Sticker Mule: when production tracking flags a delay, the agent finds the affected orders and the on-duty supervisor, asks for the cause and a new estimate, updates the order dates, and informs support or asks a human to approve an action.

See `PROJECT_BRIEF.md` for scope and build steps.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values.
3. `npm run db:ping` to check the database connection.
4. `npm run dev` and open http://localhost:3000
