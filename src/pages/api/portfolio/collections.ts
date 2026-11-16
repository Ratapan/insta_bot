// Colecciones curadas del portafolio: lista y creación.
//   GET  → { collections: CollectionSummary[], sessions: { session, count }[] }
//   GET  ?session= → { urls }   (fotos de una sesión, en orden de captura)
//   POST { …CollectionInput, fromSession? } → 201 { collection }
//        fromSession: arma la colección con las fotos de esa sesión (en orden
//        de captura) si no vienen fotos.
//   codes: invalid_fields, slug_taken, published_requires_photos, cover_not_in_photos
import type { APIRoute } from "astro";
import { createCollection, listCollections } from "../../../lib/portfolioCollectionsDb";
import { imageUrlsBySession, sessionsInUse } from "../../../lib/portfolioDb";
import { sessionNameSchema } from "../../../lib/portfolioSchema";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const KNOWN = new Set(["invalid_fields", "slug_taken", "published_requires_photos", "cover_not_in_photos"]);

export const GET: APIRoute = async (context) => {
  // ?session= → solo las URLs de esa sesión (para "Agregar sesión" en el editor).
  const session = sessionNameSchema.safeParse(context.url.searchParams.get("session"));
  if (session.success) {
    try {
      return json({ urls: await imageUrlsBySession(session.data) });
    } catch (err) {
      console.error("[portfolio/collections] GET session", err);
      return json({ error: "portfolio_unavailable" }, 502);
    }
  }
  try {
    const [collections, sessions] = await Promise.all([listCollections(), sessionsInUse()]);
    return json({ collections, sessions });
  } catch (err) {
    console.error("[portfolio/collections] GET", err);
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

  try {
    const fromSession = sessionNameSchema.safeParse(body.fromSession);
    if (fromSession.success && !(Array.isArray(body.photos) && body.photos.length)) {
      body = { ...body, photos: await imageUrlsBySession(fromSession.data) };
    }
    delete body.fromSession;
    const collection = await createCollection(body);
    return json({ collection }, 201);
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (KNOWN.has(code)) return json({ error: code }, code === "slug_taken" ? 409 : 400);
    console.error("[portfolio/collections] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
