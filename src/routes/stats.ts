// @ts-nocheck
import { Elysia } from "elysia";
import sql from "../db";
import dayjs from "dayjs";

export const statsRoutes = (app: Elysia) =>
  app.group("/stats", (app) =>
    app
      // ── 1. DASHBOARD SUMMARY CARDS ─────────────────────────────
      // Returns aggregated numbers for the budget bar + quick stat cards.
      // Uses a selected month (or any date range); defaults to current month.
      .get("/dashboard", async ({ uid, query }) => {
        const start = query.start
          ? new Date(query.start).toISOString()
          : dayjs().startOf("month").toISOString();
        const end = query.end
          ? new Date(query.end).toISOString()
          : dayjs().endOf("month").toISOString();

        const rangeDays = dayjs(end).diff(dayjs(start), "day") + 1;

        const [[global], [rangeRow]] = await Promise.all([
          // Global all-time totals for budget progress bar
          sql<{ budget: string; spent: string }[]>`
            SELECT
              (SELECT COALESCE(SUM(amount), 0) FROM budget_entries WHERE user_id = ${uid})::text AS budget,
              (SELECT COALESCE(SUM(nominal), 0) FROM transactions WHERE user_id = ${uid})::text AS spent
          `,
          // Range-filtered totals + count for stat cards
          sql<{ total: string; count: string }[]>`
            SELECT
              COALESCE(SUM(nominal), 0)::text AS total,
              COUNT(*)::text AS count
            FROM transactions
            WHERE user_id = ${uid}
              AND date::timestamptz >= ${start}::timestamptz
              AND date::timestamptz <= ${end}::timestamptz
          `,
        ]);

        const totalBudget = Number(global.budget);
        const totalTransaction = Number(global.spent);
        const rangeTotal = Number(rangeRow.total);
        const rangeCount = Number(rangeRow.count);
        const dailyAvg = rangeDays > 0 ? rangeTotal / rangeDays : 0;
        const avgPerTx = rangeCount > 0 ? rangeTotal / rangeCount : 0;

        // Top category in selected range
        const [topCat] = await sql<{ name: string; total: string }[]>`
          SELECT kategori AS name, SUM(nominal)::text AS total
          FROM transactions
          WHERE user_id = ${uid}
            AND date::timestamptz >= ${start}::timestamptz
            AND date::timestamptz <= ${end}::timestamptz
          GROUP BY kategori
          ORDER BY SUM(nominal) DESC
          LIMIT 1
        `;

        return {
          success: true,
          data: {
            totalBudget,
            totalTransaction,
            rangeTotal,
            rangeCount,
            dailyAvg,
            avgPerTx,
            topCategory: topCat ? { name: topCat.name, total: Number(topCat.total) } : null,
          },
        };
      })

      // ── 2. CATEGORY BREAKDOWN ──────────────────────────────────
      // Pre-aggregated data for the donut chart. FE does zero calculation.
      .get("/category-breakdown", async ({ uid, query }) => {
        const start = query.start
          ? new Date(query.start).toISOString()
          : dayjs().startOf("month").toISOString();
        const end = query.end
          ? new Date(query.end).toISOString()
          : dayjs().endOf("month").toISOString();

        const rows = await sql<{ name: string; total: string }[]>`
          SELECT kategori AS name, SUM(nominal)::text AS total
          FROM transactions
          WHERE user_id = ${uid}
            AND date::timestamptz >= ${start}::timestamptz
            AND date::timestamptz <= ${end}::timestamptz
          GROUP BY kategori
          ORDER BY SUM(nominal) DESC
        `;

        const grandTotal = rows.reduce((s, r) => s + Number(r.total), 0);

        return {
          success: true,
          data: rows.map((r) => ({
            name: r.name,
            total: Number(r.total),
            percent: grandTotal > 0 ? (Number(r.total) / grandTotal) * 100 : 0,
          })),
        };
      })

      // ── 3. SPENDING TREND ──────────────────────────────────────
      // Aggregated per-day rows in the range. FE groups into weekly/daily/monthly.
      .get("/spending-trend", async ({ uid, query }) => {
        const start = query.start
          ? new Date(query.start).toISOString()
          : dayjs().startOf("month").toISOString();
        const end = query.end
          ? new Date(query.end).toISOString()
          : dayjs().endOf("month").toISOString();

        // Aggregate per calendar day (returns date as YYYY-MM-DD string)
        const rows = await sql<{ day: string; total: string }[]>`
          SELECT
            DATE(date::timestamptz AT TIME ZONE 'Asia/Jakarta') AS day,
            SUM(nominal)::text AS total
          FROM transactions
          WHERE user_id = ${uid}
            AND date::timestamptz >= ${start}::timestamptz
            AND date::timestamptz <= ${end}::timestamptz
          GROUP BY day
          ORDER BY day ASC
        `;

        return {
          success: true,
          data: rows.map((r) => ({ day: r.day, total: Number(r.total) })),
        };
      })

      // ── 4. PLAN SUMMARY ────────────────────────────────────────
      // Spending vs plan per category for the active plan card + chart.
      // Note: plan items are stored as a JSONB column in the plans table.
      .get("/plan-summary", async ({ uid, query }) => {
        const planId = query.planId;
        if (!planId) return { success: false, error: "planId required" };

        // Fetch the plan meta + items JSON in one query
        const [plan] = await sql<any[]>`
          SELECT id, start_date, end_date, total_amount, items
          FROM plans
          WHERE id = ${planId} AND user_id = ${uid}
        `;

        if (!plan) return { success: false, error: "Plan not found" };

        // items is already parsed from JSONB: [{ category, nominal }]
        const planItems: { category: string; nominal: number }[] =
          Array.isArray(plan.items) ? plan.items : [];

        // Real spending per category in the plan's date range
        const actualRows = await sql<{ category: string; total: string }[]>`
          SELECT kategori AS category, SUM(nominal)::text AS total
          FROM transactions
          WHERE user_id = ${uid}
            AND date::timestamptz >= ${plan.start_date}::timestamptz
            AND date::timestamptz <= ${plan.end_date}::timestamptz
          GROUP BY kategori
        `;

        const actualMap: Record<string, number> = {};
        actualRows.forEach((r) => { actualMap[r.category] = Number(r.total); });

        const planTotal = Number(plan.total_amount) || 0;
        const planSpent = Object.values(actualMap).reduce((s, v) => s + v, 0);

        return {
          success: true,
          data: {
            planId: plan.id,
            startDate: plan.start_date,
            endDate: plan.end_date,
            planTotal,
            planSpent,
            planRemaining: planTotal - planSpent,
            usagePercent: planTotal > 0 ? (planSpent / planTotal) * 100 : 0,
            categories: planItems.map((pi) => ({
              category: pi.category,
              plan: Number(pi.nominal),
              actual: actualMap[pi.category] || 0,
            })),
          },
        };
      })
  );


