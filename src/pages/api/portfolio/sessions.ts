// Sesiones de fotos del portafolio (colección `sessions` de Mongo): el
// contexto que el fotógrafo escribe al subir una sesión y que la generación
// con IA usará como insumo (Fase 3). Solo insta_bot lee esta colección.
//   GET  → { sessions }
//   PUT  { session, context? } → upsert por nombre
import type { APIRoute } from "astro";
import { listSessions, upsertSession } from "../../../lib/portfolioDb";
import { portfolioSessionInputSchema } from "../../../lib/portfolioSchema";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  try {
    const sessions = await listSessions();
    return json({ sessions });
  } catch (err) {
    console.error("[portfolio/sessions] GET", err);
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

  const parsed = portfolioSessionInputSchema.safeParse({
    session: body.session,
    context: typeof body.context === "string" ? body.context : "",
  });
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);

  try {
    const session = await upsertSession(parsed.data.session, parsed.data.context);
    return json({ session });
  } catch (err) {
    console.error("[portfolio/sessions] PUT", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
