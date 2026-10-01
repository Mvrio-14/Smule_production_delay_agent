import postgres from "postgres";

// One shared client. Plain SQL with tagged templates: sql`select ...`.
// prepare: false is required by the Supabase pooler in transaction mode (port 6543).
function createClient() {
  return postgres(process.env.DATABASE_URL!, {
    // Enough connections that a query never has to queue behind another one on the same connection:
    // the Supabase pooler (transaction mode) can leave such queued queries without an answer.
    max: 10,
    prepare: false,
    // The Supabase pooler drops idle connections; close ours first so no query waits on a dead socket.
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}, // hide "table does not exist, skipping" notices on reset
    // Tests, evals and the scenario script work in their own Postgres schema ("test"),
    // so resetting their data never touches the incidents of the app.
    ...(process.env.DB_SCHEMA && { connection: { search_path: process.env.DB_SCHEMA } }),
    types: {
      // Keep `date` columns as plain 'YYYY-MM-DD' strings instead of JS Date objects.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

// In development, Next.js reloads modules on every change; keep a single client across reloads
// so connections do not pile up.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof createClient> };
export const sql = globalForDb.sql ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
