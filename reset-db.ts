import sql from "./src/db";

await sql`DROP TABLE IF EXISTS categories CASCADE`;
await sql`CREATE TABLE categories (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, name))`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_lower ON categories (user_id, LOWER(name))`;

console.log("✅ Categories table reset");
process.exit(0);
