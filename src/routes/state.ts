// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Transaction, Category } from "../types";

const DEFAULTS = ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"];

export const stateRoutes = new Elysia()
  .group("/state", (app) =>
    app
      .get("/", async ({ uid }) => {
        const catCheck = await sql`SELECT id FROM categories WHERE user_id = ${uid} LIMIT 1`;
        if (catCheck.length === 0) {
          for (const name of DEFAULTS) {
            await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${name})`;
          }
        }

        const transactions = await sql<Transaction[]>`
          SELECT * FROM transactions WHERE user_id = ${uid} ORDER BY date DESC
        `;
        const categories = await sql<Category[]>`
          SELECT id, user_id, name, created_at FROM categories WHERE user_id = ${uid} ORDER BY name
        `;
        const [defaultRow] = await sql<{ value: string }[]>`
          SELECT value FROM settings WHERE user_id = ${uid} AND key = 'defaultBudget'
        `;
        const defaultBudget = defaultRow ? parseInt(defaultRow.value, 10) : 0;
        const monthlyRows = await sql<{ key: string; value: string }[]>`
          SELECT key, value FROM settings WHERE user_id = ${uid} AND key LIKE 'budget_%'
        `;
        const monthlyBudgets = monthlyRows.map((r) => ({
          month: r.key.replace("budget_", ""), amount: parseInt(r.value, 10),
        }));
        return { transactions, categories, defaultBudget, monthlyBudgets };
      })

      .post(
        "/",
        async ({ uid, body }) => {
          const { transactions, categories, defaultBudget, monthlyBudgets } = body as any;
          if (transactions?.length > 0) {
            for (const tx of transactions as Transaction[]) {
              await sql`
                INSERT INTO transactions (id, user_id, name, nominal, kategori, keterangan, date, source)
                VALUES (${tx.id}, ${uid}, ${tx.name || "Migrated"}, ${tx.nominal}, ${tx.kategori}, ${tx.keterangan || ""}, ${tx.date}, ${tx.source || "Web"})
                ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name, nominal = EXCLUDED.nominal,
                kategori = EXCLUDED.kategori, keterangan = EXCLUDED.keterangan, date = EXCLUDED.date, source = EXCLUDED.source
              `;
            }
          }
          if (categories?.length > 0) {
            for (const cat of categories as Category[]) {
              const e = await sql`SELECT id FROM categories WHERE user_id = ${uid} AND LOWER(name) = LOWER(${cat.name})`;
              if (e.length === 0) await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${cat.name})`;
            }
          }
          if (defaultBudget !== undefined) {
            await sql`INSERT INTO settings (user_id, key, value) VALUES (${uid}, 'defaultBudget', ${String(defaultBudget)}) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`;
          }
          if (monthlyBudgets?.length > 0) {
            for (const b of monthlyBudgets as { month: string; amount: number }[]) {
              await sql`INSERT INTO settings (user_id, key, value) VALUES (${uid}, ${`budget_${b.month}`}, ${String(b.amount)}) ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`;
            }
          }
          return { success: true };
        },
        { body: t.Any() }
      )
  );
