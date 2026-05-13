import { Elysia, t } from "elysia";

const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY ?? "";
const OCR_SPACE_URL = "https://api.ocr.space/parse/image";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ── Step 1: OCR image → raw text ─────────────────────────────────────────────
async function extractTextFromImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("apikey", OCR_SPACE_API_KEY);
  formData.append("file", file);
  formData.append("language", "eng");
  formData.append("OCREngine", "3");
  formData.append("isTable", "false");

  const response = await fetch(OCR_SPACE_URL, {
    method: "POST",
    body: formData,
  });
  const result = await response.json();
  return result?.ParsedResults?.[0]?.ParsedText ?? "";
}

// ── Step 2: raw text → structured JSON via Groq ───────────────────────────────
async function parseReceiptWithGroq(rawText: string) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY belum diset di .env");
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0, // deterministic — reduces hallucination
      messages: [
        {
          role: "system",
          content: `Ekstraktor data struk belanja. Output: JSON murni, tanpa markdown.
Aturan:
- Hanya data yang ada di teks. Tidak ada → null.
- name: nama toko/penjual, jika tidak ada → null.
- nominal: nilai TOTAL AKHIR tertera (setelah diskon), jangan hitung manual.
- items: hanya item yang ada nama+harganya.
  - name: nama item.
  - price = total baris (sudah × qty).
  - qty = posisi kuantitas di struk belanja sering BERBEDA BEDA. terkadang ada sebelum nama barang, sesudah nama barang atau di baris terpisah, terkadang format kuantitas misal 2 item ditulis seperti "2x" atau "2*" atau "@2" atau "x2" atau "2".
- date: format YYYY-MM-DD, gunakan hari ini jika tidak ada.
Format:
{"name":string|null,"nominal":number|null,"kategori":"Makanan|Transport|Belanja|Hiburan|Tagihan|Lainnya","keterangan":"Scan stuk by AI","date":"YYYY-MM-DD","items":[{"name":string,"price":number, qty:number}]}`,
        },
        {
          role: "user",
          content: rawText,
        },
      ],
    }),
  });

  const data = await response.json();

  console.log("=== Groq Response ===");
  console.log(JSON.stringify(data, null, 2));
  console.log("====================");

  if (data.error) {
    throw new Error(
      `Groq API error: ${data.error.message ?? JSON.stringify(data.error)}`,
    );
  }

  const rawJson: string = data?.choices?.[0]?.message?.content ?? "";

  if (!rawJson.trim()) {
    throw new Error("Groq mengembalikan response kosong.");
  }

  // Strip markdown code fences if model wraps the JSON
  const cleaned = rawJson.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Groq mengembalikan format bukan JSON:\n${rawJson}`);
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export const ocrRoutes = (app: Elysia) =>
  app.group("/ocr", (app) =>
    app.post(
      "/",
      async ({ body, set }) => {
        const file = body.file as File;

        try {
          // Step 1: extract text via OCR.space
          const rawText = await extractTextFromImage(file);
          console.log(
            "=== OCR.space Raw Text ===\n",
            rawText,
            "\n=========================",
          );

          if (!rawText.trim()) {
            set.status = 422;
            return { error: "Teks tidak terdeteksi dari gambar." };
          }

          // Step 2: parse to FE-ready JSON via Groq
          const parsed = await parseReceiptWithGroq(rawText);
          console.log(
            "=== Parsed Result ===\n",
            parsed,
            "\n====================",
          );

          return parsed;
        } catch (error: any) {
          console.error("OCR Error:", error);
          set.status = 500;
          return { error: "Gagal memproses struk: " + String(error) };
        }
      },
      { body: t.Object({ file: t.File() }) },
    ),
  );
