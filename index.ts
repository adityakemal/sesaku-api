import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { cookie } from "@elysiajs/cookie";
import sql from "./src/db";
import { initDb } from "./src/db";
import { authRoutes } from "./src/routes/auth";
import { transactionRoutes } from "./src/routes/transactions";
import { categoryRoutes } from "./src/routes/categories";
import { incomeRoutes } from "./src/routes/income";
import { stateRoutes } from "./src/routes/state";
import { ocrRoutes } from "./src/routes/ocr";
import { workspaceRoutes } from "./src/routes/workspace";
import { planRoutes } from "./src/routes/plans";
import { statsRoutes } from "./src/routes/stats";
import { logActivity } from "./src/logger";
import dayjs from "dayjs";

const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";

await initDb();
console.log("✅ Database initialized");

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || "http://localhost:5173";

const setCorsHeaders = (set: any, origin?: string | null) => {
  const allow = origin || ALLOWED_ORIGIN;
  set.headers["Access-Control-Allow-Origin"] = allow;
  set.headers["Access-Control-Allow-Credentials"] = "true";
  set.headers["Access-Control-Allow-Methods"] =
    "GET, POST, PUT, DELETE, OPTIONS";
  set.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
};

const app = new Elysia()
  .use(cookie())
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))

  // Global error handler
  .onError(({ code, error, set, request }) => {
    const origin = request?.headers?.get("origin");
    setCorsHeaders(set, origin);

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

    // Forbidden Workspace
    if (set.status === 403 || error?.message === "Forbidden workspace") {
      set.status = 403;
      return {
        success: false,
        message:
          "Akses ke workspace ditolak atau kamu sudah dihapus dari workspace ini.",
        code: "WORKSPACE_FORBIDDEN",
      };
    }

    // Default
    console.error(`[${new Date().toISOString()}] ${code}:`, error?.message);
    set.status = 500;
    return { success: false, message: "Terjadi kesalahan server" };
  })

  // Request logger — runs after response
  // console.log for every non-health request; logActivity only for mutations
  // not handled by their own route (workspace/auth log themselves)
  .onAfterHandle(({ request, path, uid, userName, body }) => {
    const method = request.method;
    if (path === "/health" || !uid) return;

    const ts = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    console.log(
      `[${ts}] ${method} ${path} — ${(uid as string).slice(0, 8)}...`,
    );

    // Only persist activity for mutation methods on centrally-logged paths
    if (method === "GET" || method === "DELETE") return;

    // workspace and auth handle their own logActivity — skip to avoid duplicates
    const SELF_LOGGED_PREFIXES = ["/workspace", "/auth"];
    if (SELF_LOGGED_PREFIXES.some((p) => path.startsWith(p))) return;

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
          const nominal = b.nominal
            ? Number(b.nominal).toLocaleString("id-ID")
            : "0";
          detail = `${name} · Rp ${nominal} · ${dayjs(b.date).format("DD/MM/YYYY")} \n by ${userName ?? "?"}`;
        } else if (path.includes("budget")) {
          const amt = b.amount ? Number(b.amount).toLocaleString("id-ID") : "0";
          const label = b.note || "Budget";
          detail = `${label}: Rp ${amt}`;
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

  .derive(async ({ jwt, cookie: { auth_token }, set, request }) => {
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
    const uid = payload.sub as string;
    const email = payload.email as string;
    const userName = (payload.name as string | undefined) ?? email;
    if (!uid) {
      set.status = 401;
      throw new Error("Invalid token");
    }

    // Check for workspace context
    const requestedWorkspace = request.headers.get("x-workspace-id");
    let activeUid = uid;

    if (requestedWorkspace && requestedWorkspace !== uid) {
      // Verify the user was invited to this workspace
      const access = await sql`
        SELECT id FROM workspace_members 
        WHERE owner_id = ${requestedWorkspace} AND member_email = ${email}
      `;
      if (access.length > 0) {
        activeUid = requestedWorkspace;
      } else {
        set.status = 403;
        throw new Error("Forbidden workspace");
      }
    }

    // realUid: the actual logged in user (used for managing own spaces/members)
    // uid: the active workspace user_id (used for querying tx, categories, etc)
    // userEmail: the logged in user's email
    return { uid: activeUid, realUid: uid, userEmail: email, userName };
  })

  // Activity logs endpoint — cursor-based pagination
  .group("/activity", (app) =>
    app.get("/", async ({ uid, query }) => {
      const limit = Math.min(Number(query.limit) || 20, 50);
      const cursor = Number(query.cursor) || 0;

      const rows =
        cursor > 0
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
    }),
  )

  .use(transactionRoutes)
  .use(categoryRoutes)
  .use(incomeRoutes)
  .use(stateRoutes)
  .use(ocrRoutes)
  .use(workspaceRoutes)
  .use(planRoutes)
  .use(statsRoutes);

// Wrap Elysia with Bun.serve to inject CORS headers at the HTTP level.
// This bypasses Elysia's hook scoping issues entirely — headers are
// added to EVERY response regardless of plugin/derive scope.
Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: async (req) => {
    const origin = req.headers.get("origin") || "";
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-workspace-id",
    };

    // Handle preflight before Elysia (auth guard would block OPTIONS)
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const res = await app.fetch(req);

    // Clone the response and inject CORS headers
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
});

console.log(`🚀 sesaKu API running at http://localhost:${PORT}`);
