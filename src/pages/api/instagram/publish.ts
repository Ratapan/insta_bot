import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount } from "../../../db/schema";
import {
  MetaApiError,
  createMediaContainer,
  getContainerStatus,
  getMediaPermalink,
  publishMediaContainer,
} from "../../../lib/instagram";
import { getPresignedUrl } from "../../../lib/storage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: { storageKey?: string; caption?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const caption = (body.caption ?? "").trim();
  if (!body.storageKey || !caption) {
    return json({ error: "bad_request" }, 400);
  }
  if (caption.length > 2200) {
    return json({ error: "caption_too_long" }, 400);
  }

  const account = await db.query.instagramAccount.findFirst({
    where: eq(instagramAccount.userId, userId),
  });
  if (!account) return json({ error: "not_connected" }, 409);

  try {
    // 1. URL firmada para que los servidores de Instagram descarguen la imagen.
    const imageUrl = await getPresignedUrl(userId, body.storageKey, 3600);

    // 2. Crear el contenedor de media.
    const creationId = await createMediaContainer(
      account.accessToken,
      account.igUserId,
      imageUrl,
      caption,
    );

    // 3. Esperar a que Instagram procese la imagen.
    let status = "IN_PROGRESS";
    for (let i = 0; i < 20 && status === "IN_PROGRESS"; i++) {
      await sleep(1500);
      status = await getContainerStatus(account.accessToken, creationId);
    }
    if (status !== "FINISHED") {
      console.error("[instagram/publish] container status:", status);
      return json({ error: "container_failed", status }, 502);
    }

    // 4. Publicar.
    const mediaId = await publishMediaContainer(
      account.accessToken,
      account.igUserId,
      creationId,
    );

    let permalink: string | null = null;
    try {
      permalink = await getMediaPermalink(account.accessToken, mediaId);
    } catch {
      // El post ya está publicado; el permalink es solo un extra.
    }

    return json({ mediaId, permalink });
  } catch (err) {
    console.error("[instagram/publish]", err);
    if (err instanceof MetaApiError) {
      if (err.isAuthError) return json({ error: "reconnect" }, 409);
      return json({ error: "meta_error", message: err.message }, 502);
    }
    return json({ error: "unknown" }, 500);
  }
};
