import sql from "./src/db";

console.log("Dropping categories table...");
await sql`DROP TABLE IF EXISTS categories CASCADE`;

console.log("Creating categories table...");
await sql`
  CREATE TABLE categories (
    id         SERIAL PRIMARY KEY,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
  )
`;

console.log("Creating lowercase unique index...");
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_lower
  ON categories (user_id, LOWER(name))
`;

console.log("✅ Categories table reset successfully");
process.exit(0);
