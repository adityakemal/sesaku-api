// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Transaction } from "../types";
import { logActivity } from "../logger";

export const transactionRoutes = new Elysia()
  .group("/transactions", (app) =>
    app
      .get("/", async ({ uid }) => {
        const rows = await sql<Transaction[]>`
          SELECT * FROM transactions WHERE user_id = ${uid} ORDER BY date DESC
        `;
        return rows;
      })

      .post(
        "/",
        async ({ uid, body }) => {
          const { id, name, nominal, kategori, keterangan, date, source, details } = body;
          await sql`
            INSERT INTO transactions (id, user_id, name, nominal, kategori, keterangan, date, source, details)
            VALUES (${id}, ${uid}, ${name}, ${nominal}, ${kategori}, ${keterangan ?? ""}, ${date}, ${source ?? "Web"}, ${JSON.stringify(details ?? {})})
          `;
          return { success: true };
        },
        {
          body: t.Object({
            id: t.String(), name: t.String(), nominal: t.Number(), kategori: t.String(),
            keterangan: t.Optional(t.String()), date: t.String(), source: t.Optional(t.String()),
            details: t.Optional(t.Any()),
          }),
        }
      )

      .put(
        "/:id",
        async ({ uid, params, body }) => {
          const { id } = params;
          const { name, nominal, kategori, keterangan, date, source, details } = body;
          const result = await sql`
            UPDATE transactions
            SET name = ${name}, nominal = ${nominal}, kategori = ${kategori},
                keterangan = ${keterangan ?? ""}, date = ${date}, source = ${source ?? "Web"},
                details = ${JSON.stringify(details ?? {})}
            WHERE id = ${id} AND user_id = ${uid}
          `;
          if (result.count === 0) return { success: false, message: "Transaksi tidak ditemukan" };
          return { success: true };
        },
        {
          body: t.Object({
            name: t.String(), nominal: t.Number(), kategori: t.String(),
            keterangan: t.Optional(t.String()), date: t.String(), source: t.Optional(t.String()),
            details: t.Optional(t.Any()),
          }),
        }
      )

      .delete("/:id", async ({ uid, params }) => {
        const [tx] = await sql<Transaction[]>`
          SELECT name, nominal FROM transactions WHERE id = ${params.id} AND user_id = ${uid}
        `;
        const detail = tx
          ? `${tx.name}: Rp ${Number(tx.nominal).toLocaleString("id-ID")}`
          : "";
        await logActivity({
          user_id: uid,
          action: "DELETE transaksi",
          detail,
          status: "success",
        });
        await sql`DELETE FROM transactions WHERE id = ${params.id} AND user_id = ${uid}`;
        return { success: true };
      })
  );
