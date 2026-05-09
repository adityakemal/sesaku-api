import sql from "./src/db";

async function test() {
  const uid = "b7acc259-c3b8-4989-87d3-850859352e13";
  const limit = 5;
  const plans = await sql`
          SELECT id, user_id, start_date, end_date, items, total_amount, created_at
          FROM plans
          WHERE user_id = ${uid}
          ORDER BY start_date DESC
          LIMIT ${limit}
        `;

  if (plans.length > 0) {
    const minDate = plans[plans.length - 1].start_date;
    const maxDate = plans.reduce((max, p) => (p.end_date > max ? p.end_date : max), plans[0].end_date);
    
    console.log("Min:", minDate, "Max:", maxDate);

    try {
      const txs = await sql`
        SELECT nominal, kategori, date 
        FROM transactions 
        WHERE user_id = ${uid} 
          AND date >= ${minDate}::timestamptz 
          AND date <= ${maxDate}::timestamptz + interval '1 day' - interval '1 second'
      `;
      console.log("TXs fetched:", txs.length);

      plans.forEach(p => {
        const pStart = new Date(p.start_date).getTime();
        const pEnd = new Date(p.end_date).getTime() + 86400000 - 1; // end of day
        
        const planTxs = txs.filter(t => {
          const d = new Date(t.date).getTime();
          return d >= pStart && d <= pEnd;
        });

        p.spent = planTxs.reduce((s, t) => s + Number(t.nominal), 0);
        
        if (Array.isArray(p.items)) {
          p.items = p.items.map((item: any) => {
            const actual = planTxs
              .filter(t => t.kategori === item.category)
              .reduce((s, t) => s + Number(t.nominal), 0);
            return { ...item, actual };
          });
        }
      });
      console.log("Success!");
    } catch (err) {
      console.error("SQL Error:", err);
    }
  }
  process.exit(0);
}

test();
