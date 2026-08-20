import { db } from "@/db";
import { assets } from "@/db/schema";

export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/** Upload an image (multipart form field "file"); returns its permanent URL. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "请求必须是 multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "缺少文件字段 file" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: `不支持的图片类型：${file.type || "未知"}（支持 png/jpg/webp/gif/svg）` }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: "图片过大（最大 10MB）" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const [row] = await db
    .insert(assets)
    .values({ filename: file.name.slice(0, 200), mimeType: file.type, data: buf })
    .returning({ id: assets.id });

  return Response.json({ id: row.id, url: `/api/assets/${row.id}` });
}
