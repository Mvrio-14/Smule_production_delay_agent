import postgres from "postgres";

// One shared client. Plain SQL with tagged templates: sql`select ...`.
// prepare: false is required by the Supabase pooler in transaction mode (port 6543).
export const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });
