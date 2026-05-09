// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Transaction } from "../types";
import { logActivity } from "../logger";

export const transactionRoutes = (app: Elysia) =>
  app.group("/transactions", (app) =>
    app
      .get("/", async ({ uid, query }) => {
        const limit = Math.min(Number(query.limit) || 15, 50);
        const cursor = query.cursor ? new Date(query.cursor as string).toISOString() : null;
        const start = query.start ? new Date(query.start as string).toISOString() : null;
        const end = query.end ? new Date(query.end as string).toISOString() : null;
        
        let rows;
        let countRow;
        
        if (start && end) {
          countRow = await sql`
            SELECT COUNT(*) as total, COALESCE(SUM(nominal), 0) as amount FROM transactions
            WHERE user_id = ${uid} AND date::timestamptz >= ${start}::timestamptz AND date::timestamptz <= ${end}::timestamptz
          `;
          
          if (cursor) {
            rows = await sql<Transaction[]>`
              SELECT * FROM transactions 
              WHERE user_id = ${uid} AND date::timestamptz >= ${start}::timestamptz AND date::timestamptz <= ${end}::timestamptz AND date::timestamptz < ${cursor}::timestamptz
              ORDER BY date DESC LIMIT ${limit}
            `;
          } else {
            rows = await sql<Transaction[]>`
              SELECT * FROM transactions 
              WHERE user_id = ${uid} AND date::timestamptz >= ${start}::timestamptz AND date::timestamptz <= ${end}::timestamptz
              ORDER BY date DESC LIMIT ${limit}
            `;
          }
        } else {
          countRow = await sql`
            SELECT COUNT(*) as total, COALESCE(SUM(nominal), 0) as amount FROM transactions
            WHERE user_id = ${uid}
          `;
          
          if (cursor) {
            rows = await sql<Transaction[]>`
              SELECT * FROM transactions WHERE user_id = ${uid} AND date::timestamptz < ${cursor}::timestamptz ORDER BY date DESC LIMIT ${limit}
            `;
          } else {
            rows = await sql<Transaction[]>`
              SELECT * FROM transactions WHERE user_id = ${uid} ORDER BY date DESC LIMIT ${limit}
            `;
          }
        }

        const hasMore = rows.length === limit;
        return {
          success: true,
          data: rows,
          totalCount: Number(countRow[0].total),
          totalAmount: Number(countRow[0].amount),
          hasMore,
          nextCursor: hasMore ? rows[rows.length - 1].date : null,
        };
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
