
import { Elysia, t } from "elysia";
import sql from "../db";

export const budgetRoutes = new Elysia()
  .group("/budget", (app) =>
    app
      .get("/", async ({ uid }) => {
        return await sql`
          SELECT id, date, amount, note, created_at
          FROM budget_entries
          WHERE user_id = ${uid}
          ORDER BY date DESC
        `;
      })

      .post(
        "/",
        async ({ uid, body }) => {
          const [row] = await sql`
            INSERT INTO budget_entries (id, user_id, date, amount, note)
            VALUES (${body.id || crypto.randomUUID()}, ${uid}, ${body.date || new Date().toISOString()}, ${body.amount}, ${body.note || ""})
            RETURNING id, date, amount, note, created_at
          `;
          return row;
        },
        {
          body: t.Object({
            id: t.Optional(t.String()),
            date: t.Optional(t.String()),
            amount: t.Number(),
            note: t.Optional(t.String()),
          }),
        }
      )

      .put(
        "/:id",
        async ({ uid, params, body, set }) => {
          const [row] = await sql`
            UPDATE budget_entries
            SET amount = ${body.amount}, note = ${body.note || ""}
            WHERE id = ${params.id} AND user_id = ${uid}
            RETURNING id, date, amount, note, created_at
          `;
          if (!row) { set.status = 404; return { message: "Tidak ditemukan" }; }
          return row;
        },
        {
          body: t.Object({
            amount: t.Number(),
            note: t.Optional(t.String()),
          }),
        }
      )

      .delete("/:id", async ({ uid, params, set }) => {
        const result = await sql`
          DELETE FROM budget_entries WHERE id = ${params.id} AND user_id = ${uid}
        `;
        if (result.count === 0) { set.status = 404; return { message: "Tidak ditemukan" }; }
        return { success: true };
      })
  );
