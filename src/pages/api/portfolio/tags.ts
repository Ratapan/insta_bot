// Vocabulario controlado de categorías (colección `tags` de Mongo).
//   GET  → { tags }
//   POST { name } → añade el tag si no existe (aprobación de una sugerencia
//        del lote). El CRUD completo (rename, merge, jerarquía) es de Fase 4.
import type { APIRoute } from "astro";
import { listTags, upsertTag } from "../../../lib/portfolioDb";
import { tagSchema } from "../../../lib/portfolioSchema";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  try {
    const tags = await listTags();
    return json({ tags });
  } catch (err) {
    console.error("[portfolio/tags] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const POST: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const parsed = tagSchema.safeParse({ name: body.name, parent: null });
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);

  try {
    const tag = await upsertTag(parsed.data.name, parsed.data.parent);
    return json({ tag });
  } catch (err) {
    console.error("[portfolio/tags] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
