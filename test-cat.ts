import { Elysia } from "elysia";
import sql from "./src/db";

async function test() {
  try {
    const uid = 'default';
    const name = 'Makanan';
    await sql`INSERT INTO categories (user_id, name) VALUES (${uid}, ${name}) ON CONFLICT DO NOTHING`;
    console.log("Success");
  } catch (e) {
    console.error("ERROR:", e);
  }
  process.exit(0);
}
test();
