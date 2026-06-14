import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount } from "../../../db/schema";
import { MetaApiError } from "../../../lib/instagram";
import { PublishError, publishToInstagram } from "../../../lib/publish";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: { storageKeys?: string[]; caption?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const caption = (body.caption ?? "").trim();
  const storageKeys = body.storageKeys ?? [];
  if (!Array.isArray(storageKeys) || storageKeys.length === 0 || !caption) {
    return json({ error: "bad_request" }, 400);
  }
  if (storageKeys.length > 10) {
    return json({ error: "too_many_images" }, 400);
  }
  if (caption.length > 2200) {
    return json({ error: "caption_too_long" }, 400);
  }

  const account = await db.query.instagramAccount.findFirst({
    where: eq(instagramAccount.userId, userId),
  });
  if (!account) return json({ error: "not_connected" }, 409);

  try {
    const { mediaId, permalink } = await publishToInstagram(
      userId,
      { accessToken: account.accessToken, igUserId: account.igUserId },
      storageKeys,
      caption,
    );
    return json({ mediaId, permalink });
  } catch (err) {
    console.error("[instagram/publish]", err);
    if (err instanceof PublishError) {
      return json({ error: err.code, status: err.status }, 502);
    }
    if (err instanceof MetaApiError) {
      if (err.isAuthError) return json({ error: "reconnect" }, 409);
      return json({ error: "meta_error", message: err.message }, 502);
    }
    return json({ error: "unknown" }, 500);
  }
};
