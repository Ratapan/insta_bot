// Un post del portafolio por slug: lectura para editar, actualización y borrado.
//   GET    ?slug=  → { blog }                      (404 not_found)
//   PUT    ?slug= { …BlogInput } → { blog }         (codes: invalid_fields, not_found, slug_taken)
//   DELETE ?slug=  → { deleted: true }              (404 not_found)
// El GET normaliza la forma legacy (imageUrl→url, fechas Date); el PUT nunca
// crea (404 si el slug no existe) y puede cambiar el slug del post.
import type { APIRoute } from "astro";
import {
  deleteBlogBySlug,
  findBlogBySlug,
  normalizeBlogForEditor,
  updateBlogBySlug,
} from "../../../lib/portfolioBlogDb";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  const slug = context.url.searchParams.get("slug")?.trim();
  if (!slug) return json({ error: "bad_request" }, 400);

  try {
    const doc = await findBlogBySlug(slug);
    if (!doc) return json({ error: "not_found" }, 404);
    return json({ blog: normalizeBlogForEditor(doc) });
  } catch (err) {
    console.error("[portfolio/blog] GET", err);
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
    const updated = await updateBlogBySlug(slug, body);
    return json({ blog: normalizeBlogForEditor(updated) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "invalid_fields") return json({ error: code }, 400);
    if (code === "not_found") return json({ error: code }, 404);
    if (code === "slug_taken") return json({ error: code }, 409);
    console.error("[portfolio/blog] PUT", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const DELETE: APIRoute = async (context) => {
  const slug = context.url.searchParams.get("slug")?.trim();
  if (!slug) return json({ error: "bad_request" }, 400);

  try {
    const deleted = await deleteBlogBySlug(slug);
    if (!deleted) return json({ error: "not_found" }, 404);
    return json({ deleted: true });
  } catch (err) {
    console.error("[portfolio/blog] DELETE", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
