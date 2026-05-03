import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { cookie } from "@elysiajs/cookie";
import sql from "./src/db";
import { initDb } from "./src/db";
import { authRoutes } from "./src/routes/auth";
import { transactionRoutes } from "./src/routes/transactions";
import { categoryRoutes } from "./src/routes/categories";
import { budgetRoutes } from "./src/routes/budget";
import { stateRoutes } from "./src/routes/state";
import { ocrRoutes } from "./src/routes/ocr";
import { logActivity } from "./src/logger";

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";

await initDb();
console.log("✅ Database initialized");

const app = new Elysia()
  .use(
    cors({
      origin: "*",
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  )
  .use(cookie())
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))

  // Global error handler
  .onError(({ code, error, set }) => {
    const pgError = error as { code?: string; message?: string };

    // Postgres unique violation
    if (pgError.code === "23505") {
      set.status = 409;
      return { success: false, message: "Data sudah ada" };
    }

    // Postgres foreign key violation
    if (pgError.code === "23503") {
      set.status = 400;
      return { success: false, message: "Data masih direferensi" };
    }

    // Postgres not-null violation
    if (pgError.code === "23502") {
      set.status = 400;
      return { success: false, message: "Data tidak boleh kosong" };
    }

    // Postgres undefined value
    if (pgError.code === "42703" || pgError.message?.includes("Undefined")) {
      set.status = 400;
      return { success: false, message: "Parameter tidak lengkap" };
    }

    // Elysia validation error
    if (code === "VALIDATION") {
      set.status = 422;
      return {
        success: false,
        message: pgError.message || "Data tidak valid",
      };
    }

    // Not found
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { success: false, message: "Endpoint tidak ditemukan" };
    }

    // Parse error (invalid JSON)
    if (code === "PARSE") {
      set.status = 400;
      return { success: false, message: "Request body tidak valid" };
    }

    // Unauthorized
    if (set.status === 401 || error?.message === "Unauthorized") {
      set.status = 401;
      return { success: false, message: "Silakan login terlebih dahulu" };
    }

    // Default
    console.error(`[${new Date().toISOString()}] ${code}:`, error?.message);
    set.status = 500;
    return { success: false, message: "Terjadi kesalahan server" };
  })

  // Request logger — runs after response (mutations + auth only)
  .onAfterHandle(({ request, path, uid, body }) => {
    const method = request.method;
    if (path === "/health" || !uid) return;

    const ts = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    console.log(`[${ts}] ${method} ${path} — ${(uid as string).slice(0, 8)}...`);

    if (method === "GET") return;
    if (method === "DELETE") return;

    const action = path.split("/")[1] || path;
    const label: Record<string, string> = {
      categories: "kategori",
      transactions: "transaksi",
      budget: "budget",
      state: "state",
    };
    const actionLabel = label[action] || action;

    let detail = "";
    try {
      const b = body as any;
      if (b && typeof b === "object") {
        if (path.includes("transactions")) {
          const name = b.name || "";
          const nominal = b.nominal ? Number(b.nominal).toLocaleString("id-ID") : "0";
          detail = `${name}: Rp ${nominal}`;
        } else if (path.includes("budget")) {
          const amt = b.amount ? Number(b.amount).toLocaleString("id-ID") : "0";
          const type = b.type === "default" ? "Default" : "Bulanan";
          detail = `${type}: Rp ${amt}`;
        } else if (path.includes("categories")) {
          detail = b.name || "";
        }
      }
    } catch {}

    logActivity({
      user_id: uid as string,
      action: `${method} ${actionLabel}`,
      detail,
      status: "success",
    });
  })

  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

  .use(authRoutes)

  .derive(async ({ jwt, cookie: { auth_token }, set }) => {
    const token = auth_token?.value;
    if (!token) {
      set.status = 401;
      throw new Error("Unauthorized");
    }
    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      throw new Error("Unauthorized");
    }
    const uid = payload.sub;
    if (!uid) {
      set.status = 401;
      throw new Error("Invalid token");
    }
    return { uid: uid as string };
  })

  // Activity logs endpoint — cursor-based pagination
  .group("/activity", (app) =>
    app.get("/", async ({ uid, query }) => {
      const limit = Math.min(Number(query.limit) || 20, 50);
      const cursor = Number(query.cursor) || 0;

      const rows = cursor > 0
        ? await sql`
            SELECT id, action, detail, status, created_at
            FROM activity_logs
            WHERE user_id = ${uid} AND id < ${cursor}
            ORDER BY id DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT id, action, detail, status, created_at
            FROM activity_logs
            WHERE user_id = ${uid}
            ORDER BY id DESC
            LIMIT ${limit}
          `;

      return {
        data: rows,
        hasMore: rows.length === limit,
        nextCursor: rows.length > 0 ? rows[rows.length - 1].id : null,
      };
    })
  )

  .use(transactionRoutes)
  .use(categoryRoutes)
  .use(budgetRoutes)
  .use(stateRoutes)
  .use(ocrRoutes)

  .listen(PORT);

console.log(`🚀 sesaKu API running at http://localhost:${PORT}`);
