// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";

export const budgetRoutes = new Elysia()
  .group("/budget", (app) =>
    app
      .get("/", async ({ uid }) => {
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
        return { defaultBudget, monthlyBudgets };
      })

      .post(
        "/",
        async ({ uid, body }) => {
          if (body.type === "default") {
            await sql`
              INSERT INTO settings (user_id, key, value)
              VALUES (${uid}, 'defaultBudget', ${String(body.amount)})
              ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
            `;
          } else if (body.type === "monthly" && body.month) {
            await sql`
              INSERT INTO settings (user_id, key, value)
              VALUES (${uid}, ${`budget_${body.month}`}, ${String(body.amount)})
              ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
            `;
          }
          return { success: true };
        },
        {
          body: t.Object({
            type: t.Union([t.Literal("default"), t.Literal("monthly")]),
            amount: t.Number(), month: t.Optional(t.String()),
          }),
        }
      )
  );
