import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount, scheduledPost } from "../../../db/schema";
import { nextPosition } from "../../../lib/feed";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: { storageKeys?: string[]; caption?: string; scheduledAt?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const caption = (body.caption ?? "").trim();
  const storageKeys = body.storageKeys ?? [];
  if (!Array.isArray(storageKeys) || storageKeys.length === 0) {
    return json({ error: "no_images" }, 400);
  }
  if (storageKeys.length > 10) {
    return json({ error: "too_many_images" }, 400);
  }
  if (!caption) {
    return json({ error: "bad_request" }, 400);
  }
  if (caption.length > 2200) {
    return json({ error: "caption_too_long" }, 400);
  }

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return json({ error: "bad_request" }, 400);
  }
  // Margen de 30s para tolerar el desfase de reloj/latencia del formulario.
  if (scheduledAt.getTime() < Date.now() - 30_000) {
    return json({ error: "schedule_in_past" }, 400);
  }

  const account = await db.query.instagramAccount.findFirst({
    where: eq(instagramAccount.userId, userId),
  });
  if (!account) return json({ error: "not_connected" }, 409);

  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(scheduledPost).values({
    id,
    userId,
    storageKeys,
    caption,
    scheduledAt,
    status: "pending",
    position: await nextPosition(userId),
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });

  return json({ id, scheduledAt: scheduledAt.toISOString() });
};
