import sql from "./db";

export async function logActivity(data: {
  user_id: string;
  action: string;
  detail?: string;
  status: "success" | "error";
}) {
  try {
    await sql`
      INSERT INTO activity_logs (user_id, action, detail, status)
      VALUES (${data.user_id}, ${data.action}, ${data.detail || ""}, ${data.status})
    `;
  } catch (err) {
    console.error("[logger] failed to write log:", err);
  }
}
