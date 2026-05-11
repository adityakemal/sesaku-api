import postgres from "postgres";

const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL)
  : postgres({
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

  // ── Workspace Members ──────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id           SERIAL PRIMARY KEY,
      owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_id, member_email)
    )
  `;

  // ── Incomes (formerly Budget Entries) ────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS incomes (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      amount     BIGINT NOT NULL DEFAULT 0,
      note       TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_incomes_user_date ON incomes (user_id, date)`;

  // ── Plans ──────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS plans (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      start_date   TEXT NOT NULL,
      end_date     TEXT NOT NULL,
      items        JSONB NOT NULL DEFAULT '[]',
      total_amount BIGINT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Migrations ─────────────────────────────────────────

  // pg_trgm: enables indexed ILIKE '%keyword%' search
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_transactions_search_trgm
    ON transactions USING GIN (
      (name || ' ' || kategori || ' ' || COALESCE(keterangan, '')) gin_trgm_ops
    )
  `;


  // incomes: add date column if missing (old schema had month)
  const hasDateCol = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'incomes' AND column_name = 'date'
  `;
  if (hasDateCol.length === 0) {
    await sql`ALTER TABLE incomes ADD COLUMN date TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  }
  const hasMonthCol = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'incomes' AND column_name = 'month'
  `;
  if (hasMonthCol.length > 0) {
    await sql`UPDATE incomes SET date = (month || '-01')::timestamptz WHERE date IS NULL`;
    await sql`ALTER TABLE incomes DROP COLUMN month`;
  }

  // transactions: add user_id if missing
  const txHasUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'user_id'
  `;
  if (txHasUserId.length === 0) {
    await sql`ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`;
  }

  // transactions: add details (JSONB) if missing
  const txHasDetails = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'details'
  `;
  if (txHasDetails.length === 0) {
    await sql`ALTER TABLE transactions ADD COLUMN details JSONB DEFAULT '{}'`;
  }

  // categories: add user_id if missing
  const catHasUserId = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'user_id'
  `;
  if (catHasUserId.length === 0) {
    await sql`ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`;
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

  // settings: migrate remaining budget data then drop table
  const settingsExists = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'settings'
  `;
  if (settingsExists.length > 0) {
    const settingsBudgets = await sql<{ user_id: string; key: string; value: string }[]>`
      SELECT user_id, key, value FROM settings WHERE key LIKE 'budget_%'
    `;
    for (const row of settingsBudgets) {
      const month = row.key.replace("budget_", "");
      await sql`
        INSERT INTO incomes (id, user_id, date, amount)
        VALUES (gen_random_uuid()::text, ${row.user_id}, ${(month + "-01")}::timestamptz, ${parseInt(row.value, 10) || 0})
        ON CONFLICT DO NOTHING
      `;
    }
    await sql`DROP TABLE IF EXISTS settings CASCADE`;
  }

  // ── Case-insensitive unique index on categories ────────
  await sql`DROP INDEX IF EXISTS idx_categories_name_lower`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_lower ON categories (user_id, LOWER(name))`;

  // ── Clean legacy default-user data ────────────────────
  const realUsers = await sql`SELECT COUNT(*) AS count FROM users WHERE id != 'default'`;
  if (Number(realUsers[0].count) > 0) {
    await sql`DELETE FROM transactions WHERE user_id = 'default'`;
    await sql`DELETE FROM categories WHERE user_id = 'default'`;
    await sql`DELETE FROM users WHERE id = 'default'`;
  }

  // ── Seed default categories ───────────────────────────
  const [{ count }] = await sql`SELECT COUNT(*) AS count FROM categories WHERE user_id = 'default'`;
  if (Number(count) === 0) {
    for (const name of ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"]) {
      await sql`INSERT INTO categories (user_id, name) VALUES ('default', ${name})`;
    }
  }
}

export default sql;
