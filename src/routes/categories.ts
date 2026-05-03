
import { Elysia, t } from "elysia";
import sql from "../db";

export const categoryRoutes = (app: Elysia) =>
  app.group("/category", (app) =>
    app
      .get("/", async ({ uid }) => {
        const rows = await sql`SELECT id, name FROM categories WHERE user_id = ${uid} ORDER BY name`;

        if (rows.length === 0) {
          const defaults = ["Makanan", "Transport", "Belanja", "Hiburan", "Tagihan"];
          for (const name of defaults) {
            await sql`
              INSERT INTO categories (user_id, name) VALUES (${uid}, ${name})
              ON CONFLICT (user_id, name) DO NOTHING
            `;
          }
          return await sql`SELECT id, name FROM categories WHERE user_id = ${uid} ORDER BY name`;
        }

        return rows;
      })

      .post("/", async ({ uid, body, set }) => {
        const name = (body as any).name?.trim();
        if (!name) { set.status = 400; return { message: "Nama kosong" }; }

        const [row] = await sql`
          INSERT INTO categories (user_id, name) VALUES (${uid}, ${name})
          ON CONFLICT (user_id, name) DO NOTHING
          RETURNING id, name
        `;
        if (!row) { set.status = 409; return { message: "Sudah ada" }; }
        return row;
      })

      .put("/:id", async ({ uid, params, body, set }) => {
        const name = (body as any).name?.trim();
        if (!name) { set.status = 400; return { message: "Nama kosong" }; }

        const [row] = await sql`
          UPDATE categories SET name = ${name}
          WHERE id = ${Number(params.id)} AND user_id = ${uid}
          RETURNING id, name
        `;
        if (!row) { set.status = 404; return { message: "Tidak ditemukan" }; }
        return row;
      })

      .delete("/:id", async ({ uid, params, set }) => {
        const result = await sql`
          DELETE FROM categories WHERE id = ${Number(params.id)} AND user_id = ${uid}
        `;
        if (result.count === 0) { set.status = 404; return { message: "Tidak ditemukan" }; }
        return { success: true };
      })
  );
