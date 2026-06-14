import type { APIRoute } from "astro";
import { getPresignedUrl, uploadFile } from "../../../lib/storage";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  const file = form.get("file");
  const path = String(form.get("path") ?? "");

  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: "missing_file" }), { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: "unsupported_type" }), { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return new Response(JSON.stringify({ error: "too_large" }), { status: 400 });
  }

  try {
    const key = await uploadFile(
      context.locals.user!.id,
      path,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
      file.type,
    );
    const url = await getPresignedUrl(context.locals.user!.id, key);
    return new Response(JSON.stringify({ key, url }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[storage/upload]", err);
    return new Response(JSON.stringify({ error: "storage_error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
