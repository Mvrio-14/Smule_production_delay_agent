-- Schema: first the simulated world (each table stands in for data Sticker Mule's own systems already hold),
-- then the agent runtime (incidents, trace, approvals).
-- Running this file drops and recreates everything (used by npm run db:reset).

drop table if exists customer_messages, approvals, agent_steps, messages, incidents, orders, shift_assignments, staff, sites cascade;

-- Factories. Both US sites are on New York time.
create table sites (
  id       text primary key,          -- 'amsterdam', 'gaffney'
  name     text not null,             -- 'Amsterdam, NY'
  timezone text not null              -- 'America/New_York'
);

-- People the agent can contact. Support agents are not tied to a site.
create table staff (
  id          text primary key,       -- 'ams-supervisor-3rd'
  name        text not null,
  role        text not null check (role in ('production_supervisor', 'factory_manager', 'buyer', 'support_agent')),
  site_id     text references sites,
  chat_handle text not null,          -- '@maria.lopez' (Slack handle in real life)
  check ((role = 'support_agent') = (site_id is null))
);

-- Simulates the workforce scheduling system: who supervises which site, when.
-- Dated rows, so a night shift crossing midnight is just one row.
create table shift_assignments (
  id            serial primary key,
  site_id       text not null references sites,
  shift         text not null check (shift in ('1st', '2nd', '3rd')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  supervisor_id text not null references staff,
  check (ends_at > starts_at)
);

-- Simulates the order and production planning systems: where each order is and when it should ship and arrive.
create table orders (
  id                      text primary key,     -- 'SM-10401'
  customer_name           text not null,
  product                 text not null,        -- 'Die cut stickers'
  quantity                int  not null check (quantity > 0),
  site_id                 text not null references sites,
  stage                   text not null check (stage in ('print', 'laminate', 'cut', 'pack')),
  machine_id              text not null,        -- 'laminator-2' (no machines table, see PROJECT_BRIEF.md)
  stage_started_at        timestamptz not null, -- when the order reached its current stage (running or queued)
  remaining_minutes       int  not null check (remaining_minutes > 0),  -- minutes until ready to ship per the production plan (includes waiting in the machine queue)
  shipping_method         text not null check (shipping_method in ('ups_ground', 'ups_2nd_day_air', 'ups_next_day_air')),
  promised_delivery_date  date not null,        -- promise made to the customer
  estimated_ship_date     date not null,        -- current plan, recomputed by the planning system
  estimated_delivery_date date not null,        -- current plan, recomputed by the planning system
  estimate_reason         text                  -- why the plan last changed
);

-- ===========================================================================
-- Agent runtime (step 2). Not a simulation of Sticker Mule systems: this is the agent's own state and trace.
-- ===========================================================================

-- One incident per alert. `conversation` is the full model history, saved so the agent can pause and resume.
create table incidents (
  id             serial primary key,
  trigger_event  jsonb not null,
  order_id       text not null references orders,
  status         text not null check (status in ('running', 'waiting_for_reply', 'waiting_for_approval', 'resolved', 'failed')),
  model          text not null,             -- 'openai:gpt-6.1-sol'
  conversation   jsonb not null default '[]',
  summary        text,                      -- the agent's final answer
  sim_started_at timestamptz not null,      -- simulated time of the alert (detected_at)
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  sim_resolved_at timestamptz               -- simulated time the incident closed (for durations)
);

-- Chat between the agent and staff (Slack in real life).
create table messages (
  id          serial primary key,
  incident_id int  not null references incidents on delete cascade,
  sender      text not null,                -- 'agent' or a staff id
  recipient   text not null,                -- 'agent' or a staff id
  body        text not null,
  sim_time    timestamptz not null,         -- simulated time the message was sent
  created_at  timestamptz not null default now()
);

-- Trace: one row per model call and one row per tool execution. Used by the UI, the metrics and the evals.
create table agent_steps (
  id          serial primary key,
  incident_id int  not null references incidents on delete cascade,
  kind        text not null check (kind in ('llm', 'tool')),
  tool_name   text,
  input       jsonb,
  output      jsonb,
  is_error    boolean not null default false,
  started_at  timestamptz not null,         -- real time, gives the order of the steps
  duration_ms int  not null,
  tokens_in   int,                          -- llm rows only
  tokens_out  int,
  cost_usd    double precision,
  model       text
);

-- Actions proposed by the agent that wait for a human from support (AI SDK tool approval).
create table approvals (
  id          serial primary key,
  incident_id int  not null references incidents on delete cascade,
  order_id    text not null references orders,
  tool_name   text not null check (tool_name in ('upgrade_shipping', 'message_customer')),
  input       jsonb not null,               -- frozen tool arguments
  approval_id text not null unique,         -- AI SDK approval id, used to resume
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  comment     text,                         -- support's comment, sent back to the agent
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- Simulated outbox: customer messages actually sent (email from the support tool in real life).
create table customer_messages (
  id          serial primary key,
  incident_id int  not null references incidents on delete cascade,
  order_id    text not null references orders,
  body        text not null,
  sent_at     timestamptz not null default now()
);
