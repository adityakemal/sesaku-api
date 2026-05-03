import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
  .get("/test", () => "OK")
  .listen(3003);
console.log("Listening 3003");
