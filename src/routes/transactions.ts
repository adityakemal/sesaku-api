// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Transaction } from "../types";
import { logActivity } from "../logger";

const DAILY_MUTATION_LIMIT = 200;

/** Returns 429 error string if user has hit the daily write limit, otherwise null. */
async function checkDailyMutationLimit(uid: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const [{ count }] = await sql<[{ count: string }]>`
    SELECT COUNT(*) AS count
    FROM activity_logs
    WHERE user_id = ${uid}
      AND action IN ('CREATE transaksi', 'EDIT transaksi')
      AND created_at::date = ${today}::date
  `;
  return Number(count) >= DAILY_MUTATION_LIMIT
    ? `Batas harian tercapai. Maksimal ${DAILY_MUTATION_LIMIT} transaksi per hari.`
    : null;
}

export const transactionRoutes = (app: Elysia) =>
  app.group("/transactions", (app) =>
    app
      .get("/", async ({ uid, query }) => {
        const limit = Math.min(Number(query.limit) || 15, 50);
        const start = query.start
          ? new Date(query.start as string).toISOString()
          : null;
        const end = query.end
          ? new Date(query.end as string).toISOString()
          : null;
        const all = query.all === "true";
        const search = (query.search as string | undefined)?.trim() || null;

        // Compound cursor: "ISO_DATE|uuid"
        const cursorRaw = query.cursor as string | undefined;
        const [cursorDate, cursorId] = cursorRaw
          ? cursorRaw.split("|")
          : [null, null];
        const cursorTs = cursorDate ? new Date(cursorDate).toISOString() : null;

        // ── All rows (no pagination) — for CSV export ────────────────────────
        if (all) {
          const rows =
            start && end
              ? await sql<Transaction[]>`
                SELECT * FROM transactions
                WHERE user_id = ${uid}
                  AND date::timestamptz >= ${start}::timestamptz
                  AND date::timestamptz <= ${end}::timestamptz
                ORDER BY date DESC, id DESC
              `
              : await sql<Transaction[]>`
                SELECT * FROM transactions WHERE user_id = ${uid} ORDER BY date DESC, id DESC
              `;
          const totalAmount = rows.reduce((acc, row) => acc + Number(row.nominal), 0);
          return {
            success: true,
            data: rows,
            totalCount: rows.length,
            totalAmount,
            hasMore: false,
            nextCursor: null,
          };
        }



        let rows: Transaction[];
        let countRow: any[];

        if (start && end) {
          countRow = await sql`
            SELECT COUNT(*) as total, COALESCE(SUM(nominal), 0) as amount FROM transactions
            WHERE user_id = ${uid}
              AND date::timestamptz >= ${start}::timestamptz
              AND date::timestamptz <= ${end}::timestamptz
          `;
          rows = cursorTs
            ? await sql<Transaction[]>`
                SELECT * FROM transactions
                WHERE user_id = ${uid}
                  AND date::timestamptz >= ${start}::timestamptz
                  AND date::timestamptz <= ${end}::timestamptz
                  AND (date::timestamptz < ${cursorTs}::timestamptz
                       OR (date::timestamptz = ${cursorTs}::timestamptz AND id < ${cursorId!}))
                ORDER BY date DESC, id DESC LIMIT ${limit}
              `
            : await sql<Transaction[]>`
                SELECT * FROM transactions
                WHERE user_id = ${uid}
                  AND date::timestamptz >= ${start}::timestamptz
                  AND date::timestamptz <= ${end}::timestamptz
                ORDER BY date DESC, id DESC LIMIT ${limit}
              `;
        } else {
          countRow = await sql`
            SELECT COUNT(*) as total, COALESCE(SUM(nominal), 0) as amount FROM transactions
            WHERE user_id = ${uid}
          `;
          rows = cursorTs
            ? await sql<Transaction[]>`
                SELECT * FROM transactions
                WHERE user_id = ${uid}
                  AND (date::timestamptz < ${cursorTs}::timestamptz
                       OR (date::timestamptz = ${cursorTs}::timestamptz AND id < ${cursorId!}))
                ORDER BY date DESC, id DESC LIMIT ${limit}
              `
            : await sql<Transaction[]>`
                SELECT * FROM transactions WHERE user_id = ${uid} ORDER BY date DESC, id DESC LIMIT ${limit}
              `;
        }

        const hasMore = rows.length === limit;
        const lastRow = rows[rows.length - 1];
        return {
          success: true,
          data: rows,
          totalCount: Number(countRow[0].total),
          totalAmount: Number(countRow[0].amount),
          hasMore,
          nextCursor:
            hasMore && lastRow ? `${lastRow.date}|${lastRow.id}` : null,
        };
      })

      .post(
        "/",
        async ({ uid, body, set }) => {
          const limitError = await checkDailyMutationLimit(uid);
          if (limitError) {
            set.status = 429;
            return { success: false, message: limitError };
          }

          const {
            id,
            name,
            nominal,
            kategori,
            keterangan,
            date,
            source,
            details,
          } = body;
          await sql`
            INSERT INTO transactions (id, user_id, name, nominal, kategori, keterangan, date, source, details)
            VALUES (${id}, ${uid}, ${name}, ${nominal}, ${kategori}, ${keterangan ?? ""}, ${date}, ${source ?? "Web"}, ${JSON.stringify(details ?? {})})
          `;
          return { success: true };
        },
        {
          body: t.Object({
            id: t.String(),
            name: t.String(),
            nominal: t.Number(),
            kategori: t.String(),
            keterangan: t.Optional(t.String()),
            date: t.String(),
            source: t.Optional(t.String()),
            details: t.Optional(t.Any()),
          }),
        },
      )

      .put(
        "/:id",
        async ({ uid, params, body, set }) => {
          const limitError = await checkDailyMutationLimit(uid);
          if (limitError) {
            set.status = 429;
            return { success: false, message: limitError };
          }

          const { id } = params;
          const { name, nominal, kategori, keterangan, date, source, details } = body;
          const result = await sql`
            UPDATE transactions
            SET name = ${name}, nominal = ${nominal}, kategori = ${kategori},
                keterangan = ${keterangan ?? ""}, date = ${date}, source = ${source ?? "Web"},
                details = ${JSON.stringify(details ?? {})}
            WHERE id = ${id} AND user_id = ${uid}
          `;
          if (result.count === 0)
            return { success: false, message: "Transaksi tidak ditemukan" };
          return { success: true };
        },
        {
          body: t.Object({
            name: t.String(),
            nominal: t.Number(),
            kategori: t.String(),
            keterangan: t.Optional(t.String()),
            date: t.String(),
            source: t.Optional(t.String()),
            details: t.Optional(t.Any()),
          }),
        },
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
      }),
  );
