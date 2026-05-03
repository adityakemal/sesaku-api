import * as mindee from "mindee";

const MINDEE_API_KEY = process.env.MINDEE_API_KEY || "";
const MODEL_ID = process.env.MINDEE_MODEL_ID || "90d93165-d8ee-4359-b276-d6f7355d3ec4";

interface LineItem {
  name: string;
  price: number;
}

export interface OCRResult {
  metadata: { source: string; processed_at: string; ocr: string };
  totalData: { name: string; price: number };
  supplier: string;
  date: string;
  time: string;
  total_amount: number;
  total_net: number;
  total_tax: number;
  tips_gratuity: number;
  document_type: string;
  purchase_category: string;
  purchase_subcategory: string;
  locale: string;
  receipt_number: string;
  items: LineItem[];
  additional_info: string[];
}

function parseLineItems(fields: any): LineItem[] {
  const items: LineItem[] = [];
  const lineItems = fields.line_items?.items || [];

  for (const item of lineItems) {
    const description = item.fields?.description?.value || "";
    const quantity = parseFloat(item.fields?.quantity?.value || "1");
    const totalLineAmount = parseFloat(
      item.fields?.total_price?.value ||
      item.fields?.total_amount?.value ||
      "0"
    );

    if (description && totalLineAmount > 0) {
      items.push({
        name: `${quantity} ${description}`,
        price: Math.round(totalLineAmount)
      });
    }
  }

  return items;
}

export async function processWithMindee(
  filePath: string,
  imageBuffer?: Uint8Array
): Promise<OCRResult> {
  if (!MINDEE_API_KEY) {
    throw new Error("MINDEE_API_KEY not configured");
  }

  const mindeeClient = new mindee.Client({ apiKey: MINDEE_API_KEY });

  let inputSource;
  if (imageBuffer) {
    inputSource = new mindee.BufferInput({
      buffer: Buffer.from(imageBuffer),
      filename: filePath
    });
    await inputSource.init();
  } else {
    inputSource = new mindee.PathInput({ inputPath: filePath });
  }

  const response = await mindeeClient.enqueueAndGetResult(
    mindee.product.Extraction,
    inputSource,
    { modelId: MODEL_ID, rawText: true }
  );

  const fields = response?.rawHttp?.inference?.result?.fields || {};

  const supplier = fields.supplier_name?.value || "Unknown";
  const date = fields.date?.value || "";
  const time = fields.time?.value || "";
  const totalAmount = fields.total_amount?.value || 0;
  const totalNet = fields.total_net?.value || 0;
  const totalTax = fields.total_tax?.value || 0;
  const tips = fields.tips_gratuity?.value || 0;
  const documentType = fields.document_type?.value || "";
  const purchaseCategory = fields.purchase_category?.value || "";
  const purchaseSubcategory = fields.purchase_subcategory?.value || "";
  const locale = fields.locale?.value || "";
  const receiptNumber = fields.receipt_number?.value || "";

  const items = parseLineItems(fields);

  return {
    metadata: {
      source: filePath,
      processed_at: new Date().toISOString(),
      ocr: "Mindee"
    },
    totalData: {
      name: `transaction ${supplier}`,
      price: Math.round(totalAmount)
    },
    supplier,
    date,
    time,
    total_amount: Math.round(totalAmount),
    total_net: Math.round(totalNet),
    total_tax: Math.round(totalTax),
    tips_gratuity: Math.round(tips),
    document_type: documentType,
    purchase_category: purchaseCategory,
    purchase_subcategory: purchaseSubcategory,
    locale,
    receipt_number: receiptNumber,
    items,
    additional_info: []
  };
}

export async function processMindeeFromUrl(url: string): Promise<OCRResult> {
  if (!MINDEE_API_KEY) {
    throw new Error("MINDEE_API_KEY not configured");
  }

  const mindeeClient = new mindee.Client({ apiKey: MINDEE_API_KEY });
  const inputSource = new mindee.UrlInput({ url });

  const response = await mindeeClient.enqueueAndGetResult(
    mindee.product.Extraction,
    inputSource,
    { modelId: MODEL_ID, rawText: true }
  );

  const fields = response?.rawHttp?.inference?.result?.fields || {};

  const supplier = fields.supplier_name?.value || "Unknown";
  const date = fields.date?.value || "";
  const totalAmount = fields.total_amount?.value || 0;
  const purchaseCategory = fields.purchase_category?.value || "";

  const items = parseLineItems(fields);

  return {
    metadata: {
      source: url,
      processed_at: new Date().toISOString(),
      ocr: "Mindee"
    },
    totalData: {
      name: `transaction ${supplier}`,
      price: Math.round(totalAmount)
    },
    supplier,
    date,
    time: "",
    total_amount: Math.round(totalAmount),
    total_net: 0,
    total_tax: 0,
    tips_gratuity: 0,
    document_type: "",
    purchase_category: purchaseCategory,
    purchase_subcategory: "",
    locale: "",
    receipt_number: "",
    items,
    additional_info: []
  };
}
