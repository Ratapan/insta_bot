// Sube una imagen al bucket público del portafolio: extrae el EXIF del
// original (sharp lo elimina al re-encodear), la convierte a WebP y devuelve
// la key, la URL pública y el EXIF para precargar el formulario de metadata.
import type { APIRoute } from "astro";
import { extractExif, toWebp } from "../../../lib/portfolioImage";
import { publicUrl, uploadPortfolioObject } from "../../../lib/portfolioStorage";
import { sanitizeRelPath } from "../../../lib/storage";

// Los originales de cámara pueden ser grandes; el WebP publicado será mucho
// menor (≤2560px q80).
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const file = form.get("file");
  const path = String(form.get("path") ?? "");

  if (!(file instanceof File)) {
    return json({ error: "missing_file" }, 400);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: "unsupported_type" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: "too_large" }, 400);
  }

  try {
    const original = Buffer.from(await file.arrayBuffer());

    // EXIF del original ANTES de convertir.
    const exif = extractExif(original);
    const webp = await toWebp(original);

    const baseName = sanitizeRelPath(file.name).replace(/\.[^.]+$/, "");
    if (!baseName) return json({ error: "bad_request" }, 400);
    const dir = sanitizeRelPath(path);
    const key = dir ? `${dir}/${baseName}.webp` : `${baseName}.webp`;

    await uploadPortfolioObject(key, new Uint8Array(webp), "image/webp");

    return json({
      key,
      url: publicUrl(key),
      file: `${baseName}.webp`,
      size: webp.byteLength,
      exif,
    });
  } catch (err) {
    console.error("[portfolio/upload]", err);
    return json({ error: "storage_error" }, 502);
  }
};
