// Vocabulario controlado de categorías (colección `tags` de Mongo) + su uso
// real en `images`. CRUD completo (Fase 4).
//   GET    → { tags, usage }  (usage = conteo por categoría en las imágenes)
//   POST   { name, parent? } → añade/asegura el tag (aprobar sugerencia del lote)
//   PUT    { from, to, apply? } → renombra/fusiona en TODO el portafolio;
//           apply:false (default) es dry-run y devuelve { affected, merged }
//   PATCH  { name, parent } → mueve el tag en la jerarquía (parent:null = raíz)
//   DELETE { name, purgeImages? } → borra el tag del vocabulario. Con
//           purgeImages:true además elimina la categoría de TODAS las imágenes
//           (descarte real); devuelve { purged }.
import type { APIRoute } from "astro";
import {
  categoryUsageCounts,
  deleteTag,
  listTags,
  removeCategoryEverywhere,
  renameCategoryEverywhere,
  setTagParent,
  upsertTag,
} from "../../../lib/portfolioDb";
import { tagSchema } from "../../../lib/portfolioSchema";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const name = tagSchema.shape.name;

export const GET: APIRoute = async () => {
  try {
    const [tags, usage] = await Promise.all([listTags(), categoryUsageCounts()]);
    return json({ tags, usage });
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

  const parsed = tagSchema.safeParse({
    name: body.name,
    parent: typeof body.parent === "string" ? body.parent : null,
  });
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);

  try {
    const tag = await upsertTag(parsed.data.name, parsed.data.parent);
    return json({ tag });
  } catch (err) {
    console.error("[portfolio/tags] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const PUT: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const from = name.safeParse(body.from);
  const to = name.safeParse(body.to);
  if (!from.success || !to.success) return json({ error: "invalid_fields" }, 400);
  const apply = body.apply === true;

  try {
    const result = await renameCategoryEverywhere(from.data, to.data, apply);
    return json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "same_name") {
      return json({ error: "same_name" }, 400);
    }
    console.error("[portfolio/tags] PUT", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const PATCH: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const target = name.safeParse(body.name);
  if (!target.success) return json({ error: "invalid_fields" }, 400);
  // parent: string = mover bajo ese padre; null = hacerlo raíz.
  let parent: string | null;
  if (body.parent === null) {
    parent = null;
  } else {
    const p = name.safeParse(body.parent);
    if (!p.success) return json({ error: "invalid_fields" }, 400);
    parent = p.data;
  }

  try {
    const tag = await setTagParent(target.data, parent);
    return json({ tag });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (["not_found", "parent_not_found", "parent_invalid"].includes(code)) {
      return json({ error: code }, code === "not_found" ? 404 : 400);
    }
    console.error("[portfolio/tags] PATCH", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const DELETE: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const target = name.safeParse(body.name);
  if (!target.success) return json({ error: "invalid_fields" }, 400);

  try {
    // Descarte real: saca la categoría de las imágenes. El tag puede no existir
    // (categoría huérfana), así que el borrado del vocabulario es best-effort.
    if (body.purgeImages === true) {
      const { affected } = await removeCategoryEverywhere(target.data, true);
      await deleteTag(target.data);
      return json({ deleted: true, purged: affected });
    }

    const deleted = await deleteTag(target.data);
    if (!deleted) return json({ error: "not_found" }, 404);
    return json({ deleted: true });
  } catch (err) {
    console.error("[portfolio/tags] DELETE", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
