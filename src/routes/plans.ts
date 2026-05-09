import { Elysia } from "elysia";
import sql from "../db";

export const planRoutes = new Elysia({ prefix: "/plans" })
  // Cursor-based pagination: cursor = last start_date from previous page
  .get("/", async ({ uid, query }) => {
    const limit = Math.min(Number(query.limit) || 10, 50);
    const cursor = query.cursor as string | undefined;

    const plans = cursor
      ? await sql`
          SELECT id, user_id, start_date, end_date, items, total_amount, created_at
          FROM plans
          WHERE user_id = ${uid} AND start_date < ${cursor}
          ORDER BY start_date DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id, user_id, start_date, end_date, items, total_amount, created_at
          FROM plans
          WHERE user_id = ${uid}
          ORDER BY start_date DESC
          LIMIT ${limit}
        `;

    const hasMore = plans.length === limit;

    // Enrich plans with actual spending data
    if (plans.length > 0) {
      const minDate = plans[plans.length - 1].start_date;
      const maxDate = plans.reduce((max, p) => (p.end_date > max ? p.end_date : max), plans[0].end_date);
      
      const txs = await sql`
        SELECT nominal, kategori, date 
        FROM transactions 
        WHERE user_id = ${uid} 
          AND date::timestamptz >= ${minDate}::timestamptz 
          AND date::timestamptz <= ${maxDate}::timestamptz + interval '1 day' - interval '1 second'
      `;

      plans.forEach(p => {
        // Adjust bounds to local date comparison similar to how frontend was doing it
        const pStart = new Date(p.start_date).getTime();
        const pEnd = new Date(p.end_date).getTime() + 86400000 - 1; // end of day
        
        const planTxs = txs.filter(t => {
          const d = new Date(t.date).getTime();
          return d >= pStart && d <= pEnd;
        });

        p.spent = planTxs.reduce((s, t) => s + Number(t.nominal), 0);
        
        if (Array.isArray(p.items)) {
          p.items = p.items.map((item: any) => {
            const actual = planTxs
              .filter(t => t.kategori === item.category)
              .reduce((s, t) => s + Number(t.nominal), 0);
            return { ...item, actual };
          });
        }
      });
    }

    return {
      success: true,
      data: plans,
      hasMore,
      nextCursor: hasMore ? plans[plans.length - 1].start_date : null,
    };
  })

  .post("/", async ({ body, uid }) => {
    const { start_date, end_date, items, total_amount } = body as any;
    if (!start_date || !end_date || !items) throw new Error("Missing required fields");

    const newId = crypto.randomUUID();
    const result = await sql`
      INSERT INTO plans (id, user_id, start_date, end_date, items, total_amount)
      VALUES (${newId}, ${uid}, ${start_date}, ${end_date}, ${sql.json(items)}, ${total_amount || 0})
      RETURNING *
    `;
    return { success: true, data: result[0] };
  })

  .put("/:id", async ({ params: { id }, body, uid }) => {
    const { start_date, end_date, items, total_amount } = body as any;
    const result = await sql`
      UPDATE plans
      SET
        start_date = COALESCE(${start_date}, start_date),
        end_date = COALESCE(${end_date}, end_date),
        items = COALESCE(${items ? sql.json(items) : null}, items),
        total_amount = COALESCE(${total_amount}, total_amount)
      WHERE id = ${id} AND user_id = ${uid}
      RETURNING *
    `;
    if (result.length === 0) throw new Error("Plan not found or unauthorized");
    return { success: true, data: result[0] };
  })

  .delete("/:id", async ({ params: { id }, uid }) => {
    const result = await sql`
      DELETE FROM plans WHERE id = ${id} AND user_id = ${uid} RETURNING id
    `;
    if (result.length === 0) throw new Error("Plan not found or unauthorized");
    return { success: true, message: "Deleted successfully" };
  })

  // Dev-only: seed past plans + transactions for testing the UI
  .post("/dev/seed", async ({ uid }) => {
    // Ensure categories exist
    const cats = ["Makanan", "Transport", "Belanja", "Hiburan"];
    for (const name of cats) {
      await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${name}) ON CONFLICT DO NOTHING`;
    }

    // ── March 2026 plan (Hemat scenario: actual < plan)
    const marId = crypto.randomUUID();
    await sql`
      INSERT INTO plans (id, user_id, start_date, end_date, items, total_amount)
      VALUES (
        ${marId}, ${uid}, '2026-03-01', '2026-03-31',
        ${sql.json([
          { category: "Makanan", nominal: 500000 },
          { category: "Transport", nominal: 200000 },
          { category: "Belanja", nominal: 300000 },
        ])},
        1000000
      ) ON CONFLICT DO NOTHING
    `;

    const marTx = [
      { name: "Makan siang", kategori: "Makanan", nominal: 45000, date: "2026-03-05" },
      { name: "Sarapan", kategori: "Makanan", nominal: 30000, date: "2026-03-08" },
      { name: "Makan siang", kategori: "Makanan", nominal: 48000, date: "2026-03-12" },
      { name: "Makan malam", kategori: "Makanan", nominal: 65000, date: "2026-03-16" },
      { name: "Makan siang", kategori: "Makanan", nominal: 55000, date: "2026-03-22" },
      { name: "Makan malam", kategori: "Makanan", nominal: 70000, date: "2026-03-28" },
      { name: "Makan siang", kategori: "Makanan", nominal: 60000, date: "2026-03-31" },
      { name: "Bensin", kategori: "Transport", nominal: 80000, date: "2026-03-03" },
      { name: "Grab", kategori: "Transport", nominal: 35000, date: "2026-03-14" },
      { name: "Bensin", kategori: "Transport", nominal: 75000, date: "2026-03-25" },
      { name: "Supermarket", kategori: "Belanja", nominal: 120000, date: "2026-03-07" },
      { name: "Supermarket", kategori: "Belanja", nominal: 130000, date: "2026-03-20" },
    ];

    // ── April 2026 plan (Over Budget scenario: actual > plan)
    const aprId = crypto.randomUUID();
    await sql`
      INSERT INTO plans (id, user_id, start_date, end_date, items, total_amount)
      VALUES (
        ${aprId}, ${uid}, '2026-04-01', '2026-04-30',
        ${sql.json([
          { category: "Makanan", nominal: 600000 },
          { category: "Transport", nominal: 250000 },
          { category: "Hiburan", nominal: 150000 },
        ])},
        1000000
      ) ON CONFLICT DO NOTHING
    `;

    const aprTx = [
      { name: "Makan siang", kategori: "Makanan", nominal: 60000, date: "2026-04-03" },
      { name: "Sarapan", kategori: "Makanan", nominal: 45000, date: "2026-04-07" },
      { name: "Makan siang", kategori: "Makanan", nominal: 55000, date: "2026-04-10" },
      { name: "Makan malam", kategori: "Makanan", nominal: 90000, date: "2026-04-15" },
      { name: "Makan siang", kategori: "Makanan", nominal: 70000, date: "2026-04-19" },
      { name: "Makan malam", kategori: "Makanan", nominal: 85000, date: "2026-04-23" },
      { name: "Makan siang", kategori: "Makanan", nominal: 65000, date: "2026-04-27" },
      { name: "Makan malam", kategori: "Makanan", nominal: 80000, date: "2026-04-30" },
      { name: "Bensin", kategori: "Transport", nominal: 90000, date: "2026-04-04" },
      { name: "Grab", kategori: "Transport", nominal: 55000, date: "2026-04-12" },
      { name: "Bensin", kategori: "Transport", nominal: 85000, date: "2026-04-20" },
      { name: "Grab", kategori: "Transport", nominal: 65000, date: "2026-04-28" },
      { name: "Bioskop", kategori: "Hiburan", nominal: 120000, date: "2026-04-06" },
      { name: "Game online", kategori: "Hiburan", nominal: 100000, date: "2026-04-18" },
      { name: "Konser", kategori: "Hiburan", nominal: 150000, date: "2026-04-25" },
    ];

    for (const tx of [...marTx, ...aprTx]) {
      await sql`
        INSERT INTO transactions (id, user_id, name, nominal, kategori, keterangan, date, source)
        VALUES (${crypto.randomUUID()}, ${uid}, ${tx.name}, ${tx.nominal}, ${tx.kategori}, '', ${tx.date}, 'Web')
      `;
    }

    return {
      success: true,
      message: "Seed data created: March (hemat) and April (over budget) plans + transactions",
    };
  });
