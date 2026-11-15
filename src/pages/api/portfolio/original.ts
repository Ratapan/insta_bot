// Original full-res de una foto del portafolio (bucket R2 PRIVADO de originales).
//   POST multipart { url, file } → guarda el original y su key en el doc.
//        Para fotos subidas antes de guardar originales, o si el upload no pudo.
//        Antes de guardar comprueba que la proporción coincida con el WebP
//        publicado (width/height del doc): evita colgarle a una foto el
//        original de otra al elegir entre cientos de DSC*.jpg.
//        → { originalKey, image }
//        Codes: bad_request, invalid_url, not_found, unsupported_type,
//        too_large, aspect_mismatch, originals_not_configured, storage_error,
//        portfolio_unavailable.
//   GET ?url=… → { url } prefirmada (10 min) para revisar el original guardado.
//        Codes: bad_request, not_found, no_original, originals_not_configured,
//        portfolio_unavailable.
import type { APIRoute } from "astro";
import { findImageByUrl, updateImageFields } from "../../../lib/portfolioDb";
import { orientedSize } from "../../../lib/portfolioImage";
import {
  deleteOriginal,
  ORIGINAL_TYPES,
  originalKeyFor,
  originalsConfigured,
  presignOriginal,
  putOriginal,
} from "../../../lib/portfolioOriginals";
import { keyFromPublicUrl } from "../../../lib/portfolioStorage";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Diferencia relativa de proporción tolerada entre el original y el WebP
// (redondeos del resize a ≤2560px quedan muy por debajo de esto).
const ASPECT_TOLERANCE = 0.02;

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

  const url = String(form.get("url") ?? "").trim();
  const file = form.get("file");
  if (!url || !(file instanceof File)) return json({ error: "bad_request" }, 400);

  const publicKey = keyFromPublicUrl(url);
  if (!publicKey) return json({ error: "invalid_url" }, 400);
  if (!ORIGINAL_TYPES[file.type]) return json({ error: "unsupported_type" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "too_large" }, 400);
  if (!originalsConfigured()) return json({ error: "originals_not_configured" }, 503);

  let doc;
  try {
    doc = await findImageByUrl(url);
  } catch (err) {
    console.error("[portfolio/original] POST find", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
  if (!doc) return json({ error: "not_found" }, 404);

  const buffer = Buffer.from(await file.arrayBuffer());
  let size: { width: number; height: number };
  try {
    size = await orientedSize(buffer);
  } catch {
    return json({ error: "unsupported_type" }, 400);
  }
  if (doc.width && doc.height) {
    const expected = doc.width / doc.height;
    const actual = size.width / size.height;
    if (Math.abs(actual - expected) / expected > ASPECT_TOLERANCE) {
      return json({ error: "aspect_mismatch" }, 400);
    }
  }

  const originalKey = originalKeyFor(publicKey, file.type);
  try {
    await putOriginal(originalKey, new Uint8Array(buffer), file.type);
  } catch (err) {
    console.error("[portfolio/original] POST put", err);
    return json({ error: "storage_error" }, 502);
  }

  try {
    const image = await updateImageFields(url, { originalKey });
    if (!image) return json({ error: "not_found" }, 404);
    // Reemplazo con otra extensión (p. ej. .png → .jpg): el anterior queda
    // huérfano en el bucket privado; se borra best-effort.
    if (doc.originalKey && doc.originalKey !== originalKey) {
      await deleteOriginal(doc.originalKey).catch((err) =>
        console.error("[portfolio/original] delete previous", err),
      );
    }
    return json({ originalKey, image });
  } catch (err) {
    console.error("[portfolio/original] POST update", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const GET: APIRoute = async (context) => {
  const url = context.url.searchParams.get("url")?.trim();
  if (!url) return json({ error: "bad_request" }, 400);
  if (!originalsConfigured()) return json({ error: "originals_not_configured" }, 503);

  try {
    const doc = await findImageByUrl(url);
    if (!doc) return json({ error: "not_found" }, 404);
    if (!doc.originalKey) return json({ error: "no_original" }, 404);
    return json({ url: await presignOriginal(doc.originalKey) });
  } catch (err) {
    console.error("[portfolio/original] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
