// drizzle/ のSQLマイグレーションをDBに適用する
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が設定されていません（.env を確認してください）");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("マイグレーションを適用しました");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
