// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Transaction, Category } from "../types";

export const stateRoutes = (app: Elysia) =>
  app.group("/state", (app) =>
    app
    .get("/", async ({ uid }) => {
      const [categories, [budgetRow], [txRow]] = await Promise.all([
        sql<Category[]>`
          SELECT id, user_id, name, created_at FROM categories WHERE user_id = ${uid} ORDER BY name
        `,
        sql<{ total: string }[]>`
          SELECT COALESCE(SUM(amount), 0)::text AS total FROM budget_entries WHERE user_id = ${uid}
        `,
        sql<{ total: string }[]>`
          SELECT COALESCE(SUM(nominal), 0)::text AS total FROM transactions WHERE user_id = ${uid}
        `,
      ]);

      return {
        transactions: [], // Return empty array to not break legacy store code immediately, but it's no longer used
        categories,
        totalBudget: Number(budgetRow.total),
        totalTransaction: Number(txRow.total),
      };
    })

    .post(
      "/",
      async ({ uid, body }) => {
        const { transactions, categories } = body as any;
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
            const e =
              await sql`SELECT id FROM categories WHERE user_id = ${uid} AND LOWER(name) = LOWER(${cat.name})`;
            if (e.length === 0)
              await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${cat.name})`;
          }
        }
        return { success: true };
      },
      { body: t.Any() },
    ),
);
