// Drops all tables, recreates the schema and inserts the seed. Run: npm run db:reset
import { sql } from "@/lib/db";
import { resetDatabase } from "@/db/seed";

await resetDatabase();
const [counts] = await sql`
  select (select count(*) from staff) as staff,
         (select count(*) from shift_assignments) as shifts,
         (select count(*) from orders) as orders`;
console.log("Database reset:", counts);
await sql.end();
