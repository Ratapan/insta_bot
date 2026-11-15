// Sube una imagen al portafolio y deja su doc listo en Mongo:
//   1. EXIF del ORIGINAL (sharp lo elimina al re-encodear) → WebP ≤2560px →
//      facts del WebP (dimensiones visibles + color promedio).
//   2. WebP → bucket PÚBLICO. Obligatorio: si falla, 502 storage_error.
//   3. Original tal cual → bucket PRIVADO de originales. Best-effort: sin
//      PORTFOLIO_ORIGINALS_BUCKET se salta; si falla se informa y se puede
//      reintentar con "Adjuntar original" (POST /api/portfolio/original).
//   4. Upsert del doc con los datos técnicos (EXIF + facts + originalKey +
//      session si la carpeta es blog/images/{sesión}). Best-effort también.
//      upsertImage inserta SIEMPRE con visible:false, así que nada se publica
//      sin revisión, y ninguna subida queda huérfana ni pierde su original.
//
// Respuesta: { key, url, file, size, exif, facts, originalKey, original, image,
//   docError? }   original: "stored" | "not_configured" | "failed"
//   image = el doc creado/actualizado, o null si Mongo falló (docError).
import type { APIRoute } from "astro";
import { upsertImage, type PortfolioImage } from "../../../lib/portfolioDb";
import {
  extractExif,
  imageFacts,
  toWebp,
  type ImageFacts,
} from "../../../lib/portfolioImage";
import {
  originalKeyFor,
  originalsConfigured,
  putOriginal,
} from "../../../lib/portfolioOriginals";
import {
  publicUrl,
  sessionFromKey,
  uploadPortfolioObject,
} from "../../../lib/portfolioStorage";
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

  let baseName: string;
  let dir: string;
  try {
    baseName = sanitizeRelPath(file.name).replace(/\.[^.]+$/, "");
    dir = sanitizeRelPath(path);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!baseName || baseName.includes("/")) return json({ error: "bad_request" }, 400);
  const key = dir ? `${dir}/${baseName}.webp` : `${baseName}.webp`;
  const url = publicUrl(key);

  // 1 + 2: procesado y WebP público (lo único obligatorio).
  let original: Buffer;
  let exif: ReturnType<typeof extractExif>;
  let webp: Buffer;
  let facts: ImageFacts | null;
  try {
    original = Buffer.from(await file.arrayBuffer());
    // EXIF del original ANTES de convertir.
    exif = extractExif(original);
    webp = await toWebp(original);
    facts = await imageFacts(webp).catch(() => null);
    await uploadPortfolioObject(key, new Uint8Array(webp), "image/webp");
  } catch (err) {
    console.error("[portfolio/upload]", err);
    return json({ error: "storage_error" }, 502);
  }

  // 3: original al bucket privado (best-effort).
  let originalKey: string | null = null;
  let originalStatus: "stored" | "not_configured" | "failed" = "not_configured";
  if (originalsConfigured()) {
    try {
      const candidate = originalKeyFor(key, file.type);
      await putOriginal(candidate, new Uint8Array(original), file.type);
      originalKey = candidate;
      originalStatus = "stored";
    } catch (err) {
      console.error("[portfolio/upload] original", err);
      originalStatus = "failed";
    }
  }

  // 4: doc con los datos técnicos (best-effort).
  const session = sessionFromKey(key);
  let image: PortfolioImage | null = null;
  let docError: string | undefined;
  try {
    image = await upsertImage(url, `${baseName}.webp`, {
      ...exif,
      ...(facts ?? {}),
      ...(originalKey ? { originalKey } : {}),
      ...(session ? { session } : {}),
    });
  } catch (err) {
    console.error("[portfolio/upload] doc", err);
    docError = "portfolio_unavailable";
  }

  return json({
    key,
    url,
    file: `${baseName}.webp`,
    size: webp.byteLength,
    exif,
    facts,
    originalKey,
    original: originalStatus,
    image,
    ...(docError ? { docError } : {}),
  });
};
