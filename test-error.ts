import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

const app = new Elysia()
  .use(cors())
  .onError(({ set }) => {
    set.status = 500;
    return { error: "Something went wrong" };
  })
  .get("/throw", () => {
    throw new Error("Test error");
  })
  .listen(3002);
console.log("Listening on 3002");
