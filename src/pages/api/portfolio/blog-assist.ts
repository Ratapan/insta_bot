// Asistencias de IA por campo del editor de blogs (Fase 3). Ruta delgada:
// valida, arma el grounding con datos existentes y delega la generación a
// claude.ts. Body discriminado por `kind`.
//   excerpt | description | title | tags → { title, contentText, tone? }
//   image_caption                        → { url, tone, postTitle?, postExcerpt?,
//                                            precedingText?, currentCaption? }
// Respuesta 200 { suggestion } (string | string[] | {caption,caption_en}).
// Codes: bad_request, invalid_fields, invalid_url, image_fetch_failed,
// rate_limited, claude_unavailable, generation_parse.
import type { APIRoute } from "astro";
import { z } from "zod";
import { db } from "../../../lib/db";
import { generationLog } from "../../../db/schema";
import {
  CaptionGenerationError,
  generateBlogFieldSuggestion,
  generateBlogImageCaption,
  normalizeImageForClaude,
} from "../../../lib/claude";
import { findImageByUrl, findSessionByName } from "../../../lib/portfolioDb";
import { getPortfolioObject, keyFromPublicUrl } from "../../../lib/portfolioStorage";
import { checkRateLimit } from "../../../lib/rateLimit";
import { isValidBlogTone } from "../../../lib/tones";

// Cuota propia (cada llamada es una request pagada a Claude).
const ASSISTS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const toneSchema = z.string().refine(isValidBlogTone, { message: "bad_tone" });

// Los strings vienen del cliente (el post puede no estar guardado): se acotan
// aquí, además de que claude.ts trunca el texto precedente a ~300 al armar el
// prompt.
const textShape = {
  title: z.string().max(200).optional().default(""),
  contentText: z.string().max(20000).optional().default(""),
  tone: toneSchema.optional(),
};

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("excerpt"), ...textShape }),
  z.object({ kind: z.literal("description"), ...textShape }),
  z.object({ kind: z.literal("title"), ...textShape }),
  z.object({ kind: z.literal("tags"), ...textShape }),
  z.object({
    kind: z.literal("image_caption"),
    url: z.string().min(1).max(2048),
    tone: toneSchema,
    postTitle: z.string().max(200).optional(),
    postExcerpt: z.string().max(500).optional(),
    precedingText: z.string().max(2000).optional(),
    currentCaption: z.string().max(1000).optional(),
  }),
]);

type AssistKind = z.infer<typeof bodySchema>["kind"];

/** Contexto de sesión (colección sessions) a partir del prefijo de la url. */
async function sessionContextForUrl(url: string): Promise<string | undefined> {
  const match = url.match(/\/blog\/images\/([^/]+)\//);
  if (!match) return undefined;
  const session = await findSessionByName(match[1]).catch(() => null);
  return session?.context?.trim() || undefined;
}

function logAssist(
  userId: string,
  kind: AssistKind,
  tone: string | null,
  suggestion: unknown,
): void {
  // Best-effort: un fallo al registrar no debe tumbar una generación exitosa.
  db.insert(generationLog)
    .values({
      id: crypto.randomUUID(),
      userId,
      source: "blog_field",
      igMediaId: null,
      context: kind,
      tone,
      withHashtags: false,
      options: { kind, suggestion },
      createdAt: new Date(),
    })
    .catch((err) => console.error("[portfolio/blog-assist] log", err));
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);
  const body = parsed.data;

  if (!checkRateLimit(`blog-assist:${userId}`, ASSISTS_PER_HOUR, HOUR_MS)) {
    return json({ error: "rate_limited" }, 429);
  }

  try {
    if (body.kind === "image_caption") {
      // Solo urls del bucket público del portfolio: la ruta no debe poder
      // hacerle fetch a urls arbitrarias.
      const key = keyFromPublicUrl(body.url);
      if (!key) return json({ error: "invalid_url" }, 400);

      let image: { base64: string; mediaType: string };
      try {
        const obj = await getPortfolioObject(key);
        image = await normalizeImageForClaude(obj.buffer);
      } catch (err) {
        console.error("[portfolio/blog-assist] image fetch", err);
        return json({ error: "image_fetch_failed" }, 502);
      }

      // Grounding factual del lado del server: descripción de catálogo (si la
      // imagen está catalogada) y contexto de la sesión (si existe).
      const [doc, sessionContext] = await Promise.all([
        findImageByUrl(body.url).catch(() => null),
        sessionContextForUrl(body.url),
      ]);
      const factualDescription =
        [doc?.caption, doc?.footer].filter(Boolean).join(" ").trim() || undefined;

      const suggestion = await generateBlogImageCaption({
        imageBase64: image.base64,
        imageMediaType: image.mediaType as never,
        tone: body.tone,
        factualDescription,
        sessionContext,
        postTitle: body.postTitle,
        postExcerpt: body.postExcerpt,
        precedingText: body.precedingText,
        currentCaption: body.currentCaption,
      });

      logAssist(userId, body.kind, body.tone, suggestion);
      return json({ suggestion });
    }

    // Campos de texto (excerpt/description/title/tags).
    const suggestion = await generateBlogFieldSuggestion({
      kind: body.kind,
      title: body.title,
      contentText: body.contentText,
      tone: body.tone,
    });
    logAssist(userId, body.kind, body.tone ?? null, suggestion);
    return json({ suggestion });
  } catch (err) {
    if (err instanceof CaptionGenerationError) {
      return json(
        { error: err.reason === "api" ? "claude_unavailable" : "generation_parse" },
        502,
      );
    }
    console.error("[portfolio/blog-assist]", err);
    return json({ error: "unknown" }, 500);
  }
};
