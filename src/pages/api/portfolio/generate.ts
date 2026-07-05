// Genera con Claude la metadata bilingüe (caption/footer es+en, categorías)
// de una imagen ya subida al bucket del portafolio. Devuelve un borrador que
// el dueño revisa y edita en el formulario antes de guardar en Mongo.
import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { generationLog } from "../../../db/schema";
import {
  CaptionGenerationError,
  generatePortfolioMetadata,
  normalizeImageForClaude,
} from "../../../lib/claude";
import { distinctCategories } from "../../../lib/portfolioDb";
import { getPortfolioObject } from "../../../lib/portfolioStorage";
import { checkRateLimit } from "../../../lib/rateLimit";

// Cuota propia (separada de captions): cada llamada es una request pagada.
const GENERATIONS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface GenerateBody {
  key: string;
  context?: string;
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: GenerateBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body.key || typeof body.key !== "string") {
    return json({ error: "bad_request" }, 400);
  }
  if (!checkRateLimit(`portfolio:${userId}`, GENERATIONS_PER_HOUR, HOUR_MS)) {
    return json({ error: "rate_limited" }, 429);
  }
  const userContext = (body.context ?? "").slice(0, 2000);

  // 1. Descargar la imagen del bucket y prepararla para Claude.
  let image: { base64: string; mediaType: string };
  try {
    const obj = await getPortfolioObject(body.key);
    image = await normalizeImageForClaude(obj.buffer);
  } catch (err) {
    console.error("[portfolio/generate] image fetch", err);
    return json({ error: "image_fetch_failed" }, 502);
  }

  // 2. Generar la metadata, pasando las categorías existentes como vocabulario.
  try {
    const existingCategories = await distinctCategories().catch(() => []);
    const metadata = await generatePortfolioMetadata({
      imageBase64: image.base64,
      imageMediaType: image.mediaType as never,
      existingCategories,
      context: userContext,
    });

    // 3. Registrar la generación (misma tabla que los captions de Instagram).
    const logId = crypto.randomUUID();
    await db.insert(generationLog).values({
      id: logId,
      userId,
      source: "portfolio_image",
      igMediaId: null,
      context: userContext || null,
      tone: null,
      withHashtags: false,
      options: metadata,
      createdAt: new Date(),
    });

    return json({ logId, metadata });
  } catch (err) {
    console.error("[portfolio/generate]", err);
    if (err instanceof CaptionGenerationError) {
      return json(
        { error: err.reason === "api" ? "claude_unavailable" : "claude_parse" },
        502,
      );
    }
    return json({ error: "unknown" }, 500);
  }
};
