import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

const secret = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";
const app = new Elysia()
  .use(jwt({ name: "jwt", secret }))
  .get("/sign", async ({ jwt }) => {
    return await jwt.sign({ sub: "default", email: "test@test.com", name: "Test" });
  })
  .listen(3005);

async function test() {
  const res = await fetch("http://localhost:3005/sign");
  const token = await res.text();
  console.log("Token:", token);
  
  const cats = await fetch("http://localhost:3001/categories", {
    headers: {
      Cookie: `auth_token=${token}`,
      Origin: "http://localhost:5173"
    }
  });
  console.log("Status:", cats.status);
  console.log("Headers:", Object.fromEntries(cats.headers.entries()));
  console.log("Body:", await cats.text());
  process.exit(0);
}
test();
