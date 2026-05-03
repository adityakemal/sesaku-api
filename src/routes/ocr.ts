// @ts-nocheck
import { Elysia, t } from "elysia";
import { processWithMindee } from "../services/mindee";

export const ocrRoutes = (app: Elysia) =>
  app.group("/ocr", (app) =>
    app.post(
      "/",
      async ({ body, set }) => {
        const file = body.file as File;
        try {
          const buffer = await file.arrayBuffer();
          return await processWithMindee(file.name || "upload", new Uint8Array(buffer));
        } catch (error: any) {
          console.error("OCR Error:", error);
          set.status = 500;
          return { error: "Gagal memproses struk: " + String(error) };
        }
      },
      { body: t.Object({ file: t.File() }) }
    )
  );
