// Cataloga una imagen HUÉRFANA del bucket (está en R2 pero sin doc en `images`):
// descarga el WebP, le extrae el EXIF y crea el doc vía upsertImage (invariantes:
// insert con visible:false, category derivado). Idempotente por url; si el WebP
// no trae EXIF, el doc se crea con los campos vacíos (edición manual después).
//   POST { url } → { image }   (codes: bad_request, invalid_url, exif_fetch_failed)
import type { APIRoute } from "astro";
import { upsertImage } from "../../../lib/portfolioDb";
import { extractExifFromUrl } from "../../../lib/portfolioImage";
import { keyFromPublicUrl } from "../../../lib/portfolioStorage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return json({ error: "bad_request" }, 400);

  // Solo URLs del bucket público del portfolio (keyFromPublicUrl → null si no).
  const key = keyFromPublicUrl(url);
  if (!key) return json({ error: "invalid_url" }, 400);
  const file = key.split("/").at(-1) ?? key;

  try {
    const exif = await extractExifFromUrl(url);
    const image = await upsertImage(url, file, exif);
    return json({ image });
  } catch (err) {
    if (err instanceof Error && err.message === "exif_fetch_failed") {
      return json({ error: "exif_fetch_failed" }, 502);
    }
    console.error("[portfolio/catalog] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
