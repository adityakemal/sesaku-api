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
  formData.append("isTable", "true");

  const response = await fetch(OCR_SPACE_URL, { method: "POST", body: formData });
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
          content: `Kamu adalah ekstractor data struk belanja. Aturan WAJIB:
1. HANYA ekstrak data yang BENAR-BENAR ADA di teks. JANGAN mengarang, menebak, atau mengisi data yang tidak ada.
2. Jika suatu field tidak ditemukan, isi dengan null (bukan string kosong, bukan angka 0).
3. Untuk "nominal": ambil nilai TOTAL AKHIR yang tertera (setelah diskon). JANGAN menghitung manual.
4. Untuk "items":
   - Hanya masukkan item yang jelas tertulis beserta harganya.
   - Jika ada quantity (contoh: "2 x Ayam Goreng Rp24.000"), gabungkan ke name menjadi "2x Ayam Goreng" dan price = qty × harga_satuan (hasilnya 48000).
   - Field "price" selalu merupakan TOTAL harga per baris item (sudah dikalikan qty), bukan harga per satuan.
   - Jika harga item tidak ada di teks, jangan masukkan item tersebut.
5. Kembalikan HANYA JSON murni, tanpa markdown, tanpa penjelasan.`,
        },
        {
          role: "user",
          content: `Ekstrak data dari teks struk ini menjadi JSON.

Teks struk:
${rawText}

Format JSON yang harus dikembalikan:
{
  "name": "nama toko/merchant yang tertera, atau null jika tidak ada",
  "nominal": total_akhir_angka_atau_null,
  "kategori": "pilih satu: Makanan | Transport | Belanja | Hiburan | Tagihan | Lainnya",
  "keterangan": "ringkasan 1 kalimat dari isi struk berdasarkan teks yang ada",
  "date": "YYYY-MM-DD dari tanggal yang tertera, atau tanggal hari ini jika tidak ada",
  "items": [
    { "name": "2x Ayam Goreng", "price": 48000 },
    { "name": "Es Teh", "price": 8000 }
  ]
}

Contoh item dengan qty: jika teks berisi "2 x Ayam Goreng Rp24.000", maka name="2x Ayam Goreng" dan price=48000 (bukan 24000).`,
        },
      ],
    }),
  });

  const data = await response.json();

  console.log("=== Groq Response ===");
  console.log(JSON.stringify(data, null, 2));
  console.log("====================");

  if (data.error) {
    throw new Error(`Groq API error: ${data.error.message ?? JSON.stringify(data.error)}`);
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
          console.log("=== OCR.space Raw Text ===\n", rawText, "\n=========================");

          if (!rawText.trim()) {
            set.status = 422;
            return { error: "Teks tidak terdeteksi dari gambar." };
          }

          // Step 2: parse to FE-ready JSON via Groq
          const parsed = await parseReceiptWithGroq(rawText);
          console.log("=== Parsed Result ===\n", parsed, "\n====================");

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
