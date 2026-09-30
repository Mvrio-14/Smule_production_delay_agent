// Checks that DATABASE_URL works. Run: npm run db:ping
import { sql } from "@/lib/db";

const [row] = await sql`select now() as now, version() as version`;
console.log("Connected:", row.now, "\n", row.version);
await sql.end();
