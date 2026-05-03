import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

const secret = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";
const app = new Elysia().use(jwt({ name: "jwt", secret })).get("/sign", async ({ jwt }) => await jwt.sign({ sub: "default", email: "test@test.com", name: "Test" })).listen(3007);

async function test() {
  const res = await fetch("http://localhost:3007/sign");
  const token = await res.text();
  
  const me = await fetch("http://localhost:3001/auth/me", {
    headers: { Cookie: `auth_token=${token}`, Origin: "http://localhost:5173" }
  });
  console.log("Me Headers:", Object.fromEntries(me.headers.entries()));
  process.exit(0);
}
test();
