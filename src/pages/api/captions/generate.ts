import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { generationLog, instagramAccount } from "../../../db/schema";
import {
  CaptionGenerationError,
  downloadImageAsBase64,
  generateCaptions,
  isSupportedImageType,
} from "../../../lib/claude";
import { MetaApiError, getMediaById } from "../../../lib/instagram";
import { getObjectAsBase64 } from "../../../lib/storage";
import { isValidTone } from "../../../lib/tones";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface GenerateBody {
  source: "ig" | "library";
  igMediaId?: string;
  storageKey?: string;
  context?: string;
  tone: string;
  withHashtags?: boolean;
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: GenerateBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (!isValidTone(body.tone)) {
    return json({ error: "invalid_tone" }, 400);
  }
  const withHashtags = body.withHashtags ?? true;
  const userContext = (body.context ?? "").slice(0, 2000);

  // 1. Obtener la imagen en base64 según la fuente.
  let image: { base64: string; mediaType: string };
  let igMediaId: string | null = null;

  try {
    if (body.source === "ig") {
      if (!body.igMediaId) return json({ error: "bad_request" }, 400);
      const account = await db.query.instagramAccount.findFirst({
        where: eq(instagramAccount.userId, userId),
      });
      if (!account) return json({ error: "not_connected" }, 409);

      const media = await getMediaById(account.accessToken, body.igMediaId);
      // Para vídeos usamos el fotograma de portada.
      const imageUrl =
        media.media_type === "VIDEO" && media.thumbnail_url
          ? media.thumbnail_url
          : media.media_url;
      image = {
        ...(await downloadImageAsBase64(imageUrl)),
      };
      igMediaId = media.id;
    } else if (body.source === "library") {
      if (!body.storageKey) return json({ error: "bad_request" }, 400);
      const obj = await getObjectAsBase64(userId, body.storageKey);
      if (!isSupportedImageType(obj.contentType)) {
        return json({ error: "unsupported_image" }, 400);
      }
      if (obj.size > 5 * 1024 * 1024) {
        return json({ error: "image_too_large" }, 400);
      }
      image = { base64: obj.base64, mediaType: obj.contentType };
    } else {
      return json({ error: "bad_request" }, 400);
    }
  } catch (err) {
    console.error("[captions/generate] image fetch", err);
    if (err instanceof MetaApiError && err.isAuthError) {
      return json({ error: "reconnect" }, 409);
    }
    return json({ error: "image_fetch_failed" }, 502);
  }

  // 2. Generar las 3 opciones con Claude.
  try {
    const options = await generateCaptions({
      imageBase64: image.base64,
      imageMediaType: image.mediaType as never,
      context: userContext,
      tone: body.tone,
      withHashtags,
    });

    // 3. Registrar la generación para iterar el prompt más adelante.
    const logId = crypto.randomUUID();
    await db.insert(generationLog).values({
      id: logId,
      userId,
      source: body.source === "ig" ? "existing_post" : "new_post",
      igMediaId,
      context: userContext || null,
      tone: body.tone,
      withHashtags,
      options,
      createdAt: new Date(),
    });

    return json({ logId, options });
  } catch (err) {
    console.error("[captions/generate]", err);
    if (err instanceof CaptionGenerationError) {
      return json({ error: err.reason === "api" ? "claude_unavailable" : "claude_parse" }, 502);
    }
    return json({ error: "unknown" }, 500);
  }
};
