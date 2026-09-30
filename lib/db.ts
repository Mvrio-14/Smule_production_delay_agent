import postgres from "postgres";

// One shared client. Plain SQL with tagged templates: sql`select ...`.
// prepare: false is required by the Supabase pooler in transaction mode (port 6543).
export const sql = postgres(process.env.DATABASE_URL!, {
  max: 5,
  prepare: false,
  onnotice: () => {}, // hide "table does not exist, skipping" notices on reset
  types: {
    // Keep `date` columns as plain 'YYYY-MM-DD' strings instead of JS Date objects.
    date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
  },
});
