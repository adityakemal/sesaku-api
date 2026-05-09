/**
 * Dev seed — generates 30 past plans (Jan 2024 – Feb 2026) with varied
 * spending scenarios so pagination and conclusion UI are fully testable.
 * Run: bun run seed.ts  (idempotent — skips existing months)
 */
import postgres from "postgres";
import dayjs from "dayjs";

const sql = postgres({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "sesaku",
  username: process.env.DB_USER || "sesaku",
  password: process.env.DB_PASSWORD || "sesaku_pass",
});

const [user] = await sql<{ id: string; email: string }[]>`
  SELECT id, email FROM users WHERE id != 'default' LIMIT 1
`;
if (!user) { console.error("❌ No users found — login first"); process.exit(1); }
const uid = user.id;
console.log(`✅ Seeding for ${user.email}`);

// Ensure categories exist
const cats = ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"];
for (const name of cats) {
  await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${name}) ON CONFLICT DO NOTHING`;
}

// Spending pattern pool — ratio = actual/planned
// Cycles through for variety across 30 months
const patterns: { cats: string[]; planBase: number; ratio: number }[] = [
  { cats: ["Makanan", "Transport", "Belanja"],           planBase: 800000,  ratio: 0.63 }, // GREAT SAVE
  { cats: ["Makanan", "Transport", "Tagihan"],           planBase: 1000000, ratio: 0.88 }, // ON TRACK
  { cats: ["Makanan", "Hiburan", "Belanja"],             planBase: 900000,  ratio: 0.99 }, // SPOT ON
  { cats: ["Makanan", "Transport", "Belanja", "Hiburan"],planBase: 1200000, ratio: 1.11 }, // EXCEEDED
  { cats: ["Makanan", "Transport", "Hiburan"],           planBase: 1000000, ratio: 1.32 }, // OVER BUDGET
  { cats: ["Makanan", "Belanja", "Tagihan"],             planBase: 750000,  ratio: 0.72 }, // GREAT SAVE
  { cats: ["Makanan", "Transport"],                      planBase: 600000,  ratio: 0.91 }, // ON TRACK
  { cats: ["Makanan", "Transport", "Belanja", "Tagihan"],planBase: 1100000, ratio: 1.01 }, // SPOT ON
  { cats: ["Makanan", "Hiburan"],                        planBase: 700000,  ratio: 1.18 }, // EXCEEDED
  { cats: ["Makanan", "Transport", "Belanja", "Hiburan"],planBase: 950000,  ratio: 1.45 }, // OVER BUDGET
];

// Generate months: Jan 2018 → Jun 2021 (42 months)
const months: { start: string; end: string }[] = [];
let cur = dayjs("2018-01-01");
const stop = dayjs("2021-07-01"); // stop before Jul 2021 (already seeded)
while (cur.isBefore(stop)) {
  months.push({
    start: cur.format("YYYY-MM-DD"),
    end: cur.endOf("month").format("YYYY-MM-DD"),
  });
  cur = cur.add(1, "month");
}

let inserted = 0;
for (let i = 0; i < months.length; i++) {
  const { start, end } = months[i];
  const p = patterns[i % patterns.length];

  // Skip if plan already exists for this period
  const existing = await sql`
    SELECT id FROM plans WHERE user_id = ${uid} AND start_date = ${start} LIMIT 1
  `;
  if (existing.length > 0) { process.stdout.write("."); continue; }

  // Build items — distribute planBase across categories
  const share = Math.floor(p.planBase / p.cats.length);
  const items = p.cats.map((cat, j) => ({
    category: cat,
    nominal: j === 0 ? p.planBase - share * (p.cats.length - 1) : share,
  }));
  const total = items.reduce((s, x) => s + x.nominal, 0);

  await sql`
    INSERT INTO plans (id, user_id, start_date, end_date, items, total_amount)
    VALUES (${crypto.randomUUID()}, ${uid}, ${start}, ${end}, ${sql.json(items)}, ${total})
  `;

  // Insert one transaction per category matching the ratio
  for (const item of items) {
    const actual = Math.round(item.nominal * p.ratio);
    await sql`
      INSERT INTO transactions (id, user_id, name, nominal, kategori, keterangan, date, source)
      VALUES (
        ${crypto.randomUUID()}, ${uid},
        ${`Pengeluaran ${item.category}`}, ${actual},
        ${item.category}, '', ${start}, 'Web'
      )
    `;
  }

  inserted++;
  process.stdout.write(`✓`);
}

console.log(`\n✅ Done — ${inserted} new plans inserted (${months.length - inserted} skipped)`);
await sql.end();
