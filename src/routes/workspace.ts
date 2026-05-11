import { Elysia, t } from "elysia";
import sql from "../db";
import { logActivity } from "../logger";

export const workspaceRoutes = (app: Elysia) =>
  app.group("/workspace", (app) =>
    app
      .get("/members", async ({ uid }) => {
        // uid here is the real user ID because they are managing their own space
        const members = await sql`
          SELECT id, member_email, created_at 
          FROM workspace_members 
          WHERE owner_id = ${uid}
          ORDER BY created_at DESC
        `;
        return members;
      })
      .post(
        "/members",
        async ({ uid, body, set }) => {
          const email = body.email.trim().toLowerCase();
          if (!email) {
            set.status = 400;
            return { message: "Email tidak boleh kosong" };
          }
          
          // Check if user is adding themselves
          const me = await sql`SELECT email FROM users WHERE id = ${uid}`;
          if (me[0]?.email === email) {
            set.status = 400;
            return { message: "Tidak bisa menambahkan diri sendiri" };
          }

          const [row] = await sql`
            INSERT INTO workspace_members (owner_id, member_email)
            VALUES (${uid}, ${email})
            ON CONFLICT (owner_id, member_email) DO NOTHING
            RETURNING id, member_email, created_at
          `;
          
          if (!row) {
            set.status = 409;
            return { message: "Member sudah ada" };
          }

          await logActivity({
            user_id: uid,
            action: "Tambah Member",
            detail: email,
            status: "success",
          });

          return row;
        },
        { body: t.Object({ email: t.String() }) }
      )
      .delete("/members/:email", async ({ uid, params, set }) => {
        const result = await sql`
          DELETE FROM workspace_members 
          WHERE owner_id = ${uid} AND member_email = ${params.email}
        `;
        if (result.count === 0) {
          set.status = 404;
          return { message: "Member tidak ditemukan" };
        }

        await logActivity({
          user_id: uid,
          action: "Hapus Member",
          detail: params.email,
          status: "success",
        });

        return { success: true };
      })
      .get("/spaces", async ({ realUid, userEmail }) => {
        // Return spaces the user has access to
        const mySpace = await sql`SELECT id, name FROM users WHERE id = ${realUid}`;
        const spaces = [
          {
            id: mySpace[0].id,
            name: "My Income Space",
            isOwner: true
          }
        ];

        const invitedSpaces = await sql`
          SELECT u.id, u.name 
          FROM workspace_members wm
          JOIN users u ON u.id = wm.owner_id
          WHERE wm.member_email = ${userEmail}
        `;

        invitedSpaces.forEach(space => {
          spaces.push({
            id: space.id,
            name: `${space.name} Income Space`,
            isOwner: false
          });
        });

        return spaces;
      })
  );
