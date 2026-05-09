import sql from "./src/db";
const uid = 'b7acc259-c3b8-4989-87d3-850859352e13';

// 1. Initial page
const p1 = await sql`SELECT start_date FROM plans WHERE user_id = ${uid} ORDER BY start_date DESC LIMIT 5`;
console.log("Page 1 (5 items):", p1.map(r => r.start_date));
const cursor1 = p1[4].start_date;

// 2. Next page
const p2 = await sql`SELECT start_date FROM plans WHERE user_id = ${uid} AND start_date < ${cursor1} ORDER BY start_date DESC LIMIT 5`;
console.log(`Page 2 (cursor < ${cursor1}):`, p2.map(r => r.start_date));

process.exit(0);
