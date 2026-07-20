// Extrae los datos técnicos (EXIF) de un WebP público del portafolio y los
// DEVUELVE, sin tocar Mongo. Lo usa la cola de revisión para rellenar los campos
// técnicos de un doc que ya existe: el triage escribe todo por su PATCH optimista
// (único escritor), así que aquí solo leemos. Para huérfanas (sin doc) está
// /api/portfolio/catalog, que sí hace upsert.
//   POST { url } → { exif }   (codes: bad_request, invalid_url, exif_fetch_failed)
import type { APIRoute } from "astro";
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
  if (!keyFromPublicUrl(url)) return json({ error: "invalid_url" }, 400);

  try {
    const exif = await extractExifFromUrl(url);
    return json({ exif });
  } catch (err) {
    if (err instanceof Error && err.message === "exif_fetch_failed") {
      return json({ error: "exif_fetch_failed" }, 502);
    }
    console.error("[portfolio/extract-exif] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
