import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { cookie } from "@elysiajs/cookie";
import sql from "../db";
import { logActivity } from "../logger";

const SECRET = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";

async function findOrCreateUser(googleUser: {
  email: string;
  name: string;
  picture: string;
  sub: string;
}) {
  const existing = await sql`SELECT * FROM users WHERE google_id = ${googleUser.sub}`;
  if (existing.length > 0) {
    await sql`UPDATE users SET name = ${googleUser.name}, avatar = ${googleUser.picture} WHERE id = ${existing[0].id}`;
    return existing[0];
  }
  const byEmail = await sql`SELECT * FROM users WHERE email = ${googleUser.email}`;
  if (byEmail.length > 0) {
    await sql`UPDATE users SET google_id = ${googleUser.sub}, avatar = ${googleUser.picture} WHERE id = ${byEmail[0].id}`;
    return byEmail[0];
  }
  const id = crypto.randomUUID();
  await sql`INSERT INTO users (id, email, name, avatar, google_id) VALUES (${id}, ${googleUser.email}, ${googleUser.name}, ${googleUser.picture || ""}, ${googleUser.sub})`;
  const [user] = await sql`SELECT * FROM users WHERE id = ${id}`;
  if (!user) throw new Error("Failed to create user");
  return user;
}

function setAuthCookie(
  cookie: Record<string, { set: (opts: Record<string, unknown>) => void }>,
  token: string
) {
  cookie.auth_token.set({
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

// Plugin function — inherits cors + jwt + cookie from parent app
export const authRoutes = (app: Elysia) =>
  app.group("/auth", (app) =>
    app
      .use(jwt({ name: "jwt", secret: SECRET }))
      .use(cookie())

      .post(
        "/google",
        async ({ body, jwt, cookie, set }) => {
          const verifyRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?id_token=${body.credential}`
          );
          if (!verifyRes.ok) {
            set.status = 401;
            return { error: "Google token tidak valid." };
          }
          const googlePayload = (await verifyRes.json()) as {
            email: string; name: string; picture: string;
            sub: string; email_verified: string;
          };
          if (googlePayload.email_verified !== "true") {
            set.status = 401;
            return { error: "Email Google belum terverifikasi." };
          }
          const user = await findOrCreateUser({
            email: googlePayload.email,
            name: googlePayload.name,
            picture: googlePayload.picture || "",
            sub: googlePayload.sub,
          });
          const token = await jwt.sign({
            sub: user.id, email: user.email,
            name: user.name, avatar: user.avatar,
            iat: Date.now(),
          });
          setAuthCookie(cookie as any, token);
          logActivity({ user_id: user.id, action: "login", status: "success" });
          return { success: true };
        },
        { body: t.Object({ credential: t.String() }) }
      )

      .post("/logout", async ({ jwt, cookie }) => {
        try {
          const token = (cookie as any).auth_token?.value;
          if (token) {
            const payload = await jwt.verify(token);
            if (payload?.sub) {
              await logActivity({ user_id: payload.sub as string, action: "logout", status: "success" });
            }
          }
        } catch {}
        (cookie as any).auth_token.remove();
        return { success: true };
      })

      .get("/me", async ({ jwt, cookie, set }) => {
        const token = (cookie as any).auth_token?.value;
        if (!token) { set.status = 401; return { error: "Unauthorized" }; }
        const payload = await jwt.verify(token);
        if (!payload) { set.status = 401; return { error: "Unauthorized" }; }
        return {
          authenticated: true,
          sub: payload.sub, email: payload.email,
          name: payload.name, avatar: payload.avatar,
        };
      })
  );
