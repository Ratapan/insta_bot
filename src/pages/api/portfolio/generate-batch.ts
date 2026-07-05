// Lote de catalogación con IA (Fase 3).
//   POST { urls: string[] } → arranca el job (uno a la vez) y devuelve
//        { jobId, total }. 409 batch_running si ya hay uno en marcha.
//   GET  ?id=… → estado del job: { status, done, total, proposals, skipped }.
// El job vive en src/lib/portfolioBatch.ts; aquí solo se valida y orquesta.
import type { APIRoute } from "astro";
import {
  getBatchJob,
  hasRunningBatchJob,
  startBatchJob,
} from "../../../lib/portfolioBatch";
import { checkRateLimit } from "../../../lib/rateLimit";

// Comparte la cuota de generación del portafolio: cada tanda de ~8 imágenes
// es una request pagada a Claude, así que se descuenta por tanda estimada.
const GENERATIONS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const MAX_URLS = 120;
const CHUNK_ESTIMATE = 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: { urls?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string" && u.length > 0)
    : [];
  if (urls.length === 0 || urls.length > MAX_URLS) {
    return json({ error: "bad_request" }, 400);
  }

  if (hasRunningBatchJob()) return json({ error: "batch_running" }, 409);

  const chunks = Math.ceil(urls.length / CHUNK_ESTIMATE);
  for (let i = 0; i < chunks; i++) {
    if (!checkRateLimit(`portfolio:${userId}`, GENERATIONS_PER_HOUR, HOUR_MS)) {
      return json({ error: "rate_limited" }, 429);
    }
  }

  try {
    const job = await startBatchJob(userId, urls);
    return json({ jobId: job.id, total: job.total });
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown";
    if (code === "batch_running") return json({ error: code }, 409);
    if (code === "not_found") return json({ error: code }, 404);
    console.error("[portfolio/generate-batch] POST", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const GET: APIRoute = async (context) => {
  const id = context.url.searchParams.get("id");
  if (!id) return json({ error: "bad_request" }, 400);
  const job = getBatchJob(id);
  if (!job) return json({ error: "not_found" }, 404);
  return json({
    id: job.id,
    status: job.status,
    error: job.error ?? null,
    total: job.total,
    done: job.done,
    proposals: job.proposals,
    skipped: job.skipped,
  });
};
