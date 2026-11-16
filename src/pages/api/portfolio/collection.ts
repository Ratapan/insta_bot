// Una colección curada por slug: lectura para editar, actualización y borrado.
//   GET    ?slug=  → { collection, photos: PhotoInfo[] }   (404 not_found)
//          photos: estado de cada foto (visible, dimensiones, caption), para
//          avisar en el editor cuáles no saldrán en el sitio.
//   PUT    ?slug= { …CollectionInput } → { collection }
//          (codes: invalid_fields, not_found, slug_taken, published_requires_photos, cover_not_in_photos)
//   DELETE ?slug=  → { deleted: true }                    (404 not_found)
import type { APIRoute } from "astro";
import {
  deleteCollectionBySlug,
  findCollectionBySlug,
  updateCollectionBySlug,
} from "../../../lib/portfolioCollectionsDb";
import { findImagesByUrls } from "../../../lib/portfolioDb";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const KNOWN = new Set(["invalid_fields", "slug_taken", "published_requires_photos", "cover_not_in_photos"]);

export const GET: APIRoute = async (context) => {
  const slug = context.url.searchParams.get("slug")?.trim();
  if (!slug) return json({ error: "bad_request" }, 400);
  try {
    const collection = await findCollectionBySlug(slug);
    if (!collection) return json({ error: "not_found" }, 404);
    const docs = await findImagesByUrls(collection.photos);
    const photos = collection.photos.map((url) => {
      const d = docs.get(url);
      return {
        url,
        exists: !!d,
        visible: d?.visible ?? false,
        width: d?.width,
        height: d?.height,
        caption: d?.caption,
        series: d?.series ?? null,
      };
    });
    return json({ collection, photos });
  } catch (err) {
    console.error("[portfolio/collection] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const PUT: APIRoute = async (context) => {
  const slug = context.url.searchParams.get("slug")?.trim();
  if (!slug) return json({ error: "bad_request" }, 400);
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  try {
    return json({ collection: await updateCollectionBySlug(slug, body) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "not_found") return json({ error: code }, 404);
    if (KNOWN.has(code)) return json({ error: code }, code === "slug_taken" ? 409 : 400);
    console.error("[portfolio/collection] PUT", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const DELETE: APIRoute = async (context) => {
  const slug = context.url.searchParams.get("slug")?.trim();
  if (!slug) return json({ error: "bad_request" }, 400);
  try {
    if (!(await deleteCollectionBySlug(slug))) return json({ error: "not_found" }, 404);
    return json({ deleted: true });
  } catch (err) {
    console.error("[portfolio/collection] DELETE", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
