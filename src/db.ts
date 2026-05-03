import postgres from "postgres";

const sql = postgres({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "sesaku",
  username: process.env.DB_USER || "sesaku",
  password: process.env.DB_PASSWORD || "sesaku_pass",
});

export async function initDb() {
  // ── Users ──────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      avatar     TEXT DEFAULT '',
      google_id  TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Transactions ───────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL DEFAULT 'default',
      name       TEXT NOT NULL,
      nominal    BIGINT NOT NULL,
      kategori   TEXT NOT NULL,
      keterangan TEXT DEFAULT '',
      date       TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'Web'
    )
  `;

  // ── Categories ─────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL DEFAULT 'default',
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, name)
    )
  `;

  // ── Settings (budgets) ─────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      id       SERIAL PRIMARY KEY,
      user_id  TEXT NOT NULL DEFAULT 'default',
      key      TEXT NOT NULL,
      value    TEXT NOT NULL,
      UNIQUE(user_id, key)
    )
  `;

  // ── Activity logs ───────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'success',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Migrations: add user_id to legacy tables ──────────

  // Transactions: add user_id column if missing
  const txHasUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'user_id'
  `;
  if (txHasUserId.length === 0) {
    await sql`ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`;
  }

  // Transactions: add details (JSONB) column for items/tax/discount
  const txHasDetails = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'details'
  `;
  if (txHasDetails.length === 0) {
    await sql`ALTER TABLE transactions ADD COLUMN details JSONB DEFAULT '{}'`;
  }

  // Categories: migrate from global to per-user
  const catHasUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'user_id'
  `;
  if (catHasUserId.length === 0) {
    await sql`ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`;
    // Drop old global unique constraint, add per-user unique
    await sql`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key`;
    await sql`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_unique`;
    const hasUserUnique = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'categories' AND constraint_name = 'categories_user_id_name_key'
    `;
    if (hasUserUnique.length === 0) {
      await sql`ALTER TABLE categories ADD CONSTRAINT categories_user_id_name_key UNIQUE (user_id, name)`;
    }
  }

  // Settings: migrate from key-only PK to (user_id, key) composite
  const setHasUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'user_id'
  `;
  if (setHasUserId.length === 0) {
    await sql`ALTER TABLE settings ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`;
    // Drop old PK on key, add auto-increment id + composite unique
    await sql`ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey`;
    // Add id column if missing (for new SERIAL PK)
    const setIdCol = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'settings' AND column_name = 'id'
    `;
    if (setIdCol.length === 0) {
      await sql`ALTER TABLE settings ADD COLUMN id SERIAL PRIMARY KEY`;
    }
    const hasSetUnique = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'settings' AND constraint_name = 'settings_user_id_key_key'
    `;
    if (hasSetUnique.length === 0) {
      await sql`ALTER TABLE settings ADD CONSTRAINT settings_user_id_key_key UNIQUE (user_id, key)`;
    }
  }

  // ── Ensure case-insensitive unique index on categories ─
  await sql`DROP INDEX IF EXISTS idx_categories_name_lower`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_lower ON categories (user_id, LOWER(name))`;

  // ── Clean legacy default-user data (if real users exist) ─
  const realUsers = await sql`SELECT COUNT(*) AS count FROM users WHERE id != 'default'`;
  if (Number(realUsers[0].count) > 0) {
    await sql`DELETE FROM transactions WHERE user_id = 'default'`;
    await sql`DELETE FROM categories WHERE user_id = 'default'`;
    await sql`DELETE FROM settings WHERE user_id = 'default'`;
    await sql`DELETE FROM users WHERE id = 'default'`;
  }

  // ── Seed default categories for default user ──────────
  const [{ count }] = await sql`
    SELECT COUNT(*) AS count FROM categories WHERE user_id = 'default'
  `;
  if (Number(count) === 0) {
    const defaults = ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"];
    for (const name of defaults) {
      await sql`
        INSERT INTO categories (user_id, name) VALUES ('default', ${name})
      `;
    }
  }

  // ── Ensure default budget exists for default user ─────
  const budgetRow = await sql`
    SELECT value FROM settings WHERE user_id = 'default' AND key = 'defaultBudget'
  `;
  if (budgetRow.length === 0) {
    await sql`
      INSERT INTO settings (user_id, key, value) VALUES ('default', 'defaultBudget', '0')
    `;
  }
}

export default sql;
