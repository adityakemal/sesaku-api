import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

const secret = process.env.JWT_SECRET || "sesaku_jwt_secret_lokal";
const app = new Elysia().use(jwt({ name: "jwt", secret })).get("/sign", async ({ jwt }) => await jwt.sign({ sub: "default", email: "test@test.com", name: "Test" })).listen(3006);

async function test() {
  const res = await fetch("http://localhost:3006/sign");
  const token = await res.text();
  
  const tx = await fetch("http://localhost:3001/transactions", {
    headers: { Cookie: `auth_token=${token}`, Origin: "http://localhost:5173" }
  });
  console.log("Tx Headers:", Object.fromEntries(tx.headers.entries()));
  process.exit(0);
}
test();
