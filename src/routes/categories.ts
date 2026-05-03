// @ts-nocheck - uid is provided by auth guard in index.ts
import { Elysia, t } from "elysia";
import sql from "../db";
import type { Category } from "../types";
import { logActivity } from "../logger";

const DEFAULTS = ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"];

export const categoryRoutes = new Elysia()
  .group("/categories", (app) =>
    app
      .get("/", async ({ uid }) => {
        const rows = await sql<Category[]>`
          SELECT id, user_id, name, created_at FROM categories
          WHERE user_id = ${uid} ORDER BY name
        `;

        if (rows.length === 0) {
          for (const name of DEFAULTS) {
            await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${name}) ON CONFLICT DO NOTHING`;
          }
          return await sql<Category[]>`
            SELECT id, user_id, name, created_at FROM categories
            WHERE user_id = ${uid} ORDER BY name
          `;
        }

        return rows;
      })

      .post(
        "/",
        async ({ uid, body, set }) => {
          const name = body.name.trim();
          if (!name) {
            set.status = 400;
            return { success: false, message: "Nama kategori tidak boleh kosong" };
          }

          const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM categories WHERE user_id = ${uid}`;
          if (Number(count) >= 7) {
            set.status = 400;
            return { success: false, message: "Maksimal 7 kategori" };
          }

          const existing = await sql`
            SELECT id FROM categories
            WHERE user_id = ${uid} AND LOWER(name) = LOWER(${name})
          `;
          if (existing.length > 0) {
            set.status = 409;
            return { success: false, message: "Kategori sudah ada" };
          }

          const [row] = await sql<Category[]>`
            INSERT INTO categories (user_id, name) VALUES (${uid}, ${name})
            RETURNING id, user_id, name, created_at
          `;
          return row;
        },
        { body: t.Object({ name: t.String() }) }
      )

      .put(
        "/:id",
        async ({ uid, params, body, set }) => {
          const id = Number(params.id);
          const name = body.name.trim();
          if (!name) {
            set.status = 400;
            return { success: false, message: "Nama kategori tidak boleh kosong" };
          }

          const existing = await sql`
            SELECT id FROM categories
            WHERE user_id = ${uid} AND LOWER(name) = LOWER(${name}) AND id != ${id}
          `;
          if (existing.length > 0) {
            set.status = 409;
            return { success: false, message: "Kategori dengan nama tersebut sudah ada" };
          }

          const [row] = await sql<Category[]>`
            UPDATE categories SET name = ${name}
            WHERE id = ${id} AND user_id = ${uid}
            RETURNING id, user_id, name, created_at
          `;
          if (!row) {
            set.status = 404;
            return { success: false, message: "Kategori tidak ditemukan" };
          }
          return row;
        },
        { body: t.Object({ name: t.String() }) }
      )

      .delete("/:id", async ({ uid, params, set }) => {
        const id = Number(params.id);
        const [cat] = await sql`SELECT name FROM categories WHERE id = ${id} AND user_id = ${uid}`;
        if (!cat) {
          set.status = 404;
          return { success: false, message: "Kategori tidak ditemukan" };
        }

        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM categories WHERE user_id = ${uid}`;
        if (Number(count) <= 1) {
          set.status = 400;
          return { success: false, message: "Minimal harus ada 1 kategori" };
        }

        await logActivity({
          user_id: uid,
          action: "DELETE kategori",
          detail: cat.name,
          status: "success",
        });
        await sql`DELETE FROM categories WHERE id = ${id} AND user_id = ${uid}`;
        return { success: true };
      })

      .delete("/name/:name", async ({ uid, params, set }) => {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM categories WHERE user_id = ${uid}`;
        if (Number(count) <= 1) {
          set.status = 400;
          return { success: false, message: "Minimal harus ada 1 kategori" };
        }
        await sql`DELETE FROM categories WHERE user_id = ${uid} AND name = ${decodeURIComponent(params.name)}`;
        return { success: true };
      })
  );
