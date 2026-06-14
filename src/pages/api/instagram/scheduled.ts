import type { APIRoute } from "astro";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../../lib/db";
import { scheduledPost } from "../../../db/schema";
import { getPresignedUrl } from "../../../lib/storage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Lista las publicaciones programadas del usuario, con una portada firmada.
export const GET: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  // Los 'draft' (huecos sin fecha) pertenecen al planificador de feed, no a la
  // cola de programadas; se excluyen de esta lista.
  const rows = await db.query.scheduledPost.findMany({
    where: and(
      eq(scheduledPost.userId, userId),
      ne(scheduledPost.status, "draft"),
    ),
    orderBy: [desc(scheduledPost.scheduledAt)],
    limit: 100,
  });

  const posts = await Promise.all(
    rows.map(async (row) => {
      let coverUrl: string | null = null;
      try {
        coverUrl = await getPresignedUrl(userId, row.storageKeys[0]);
      } catch {
        // La imagen pudo borrarse de la biblioteca; sin portada.
      }
      return {
        id: row.id,
        caption: row.caption,
        imageCount: row.storageKeys.length,
        coverUrl,
        // Sin 'draft' en la consulta, scheduledAt siempre tiene valor aquí.
        scheduledAt: row.scheduledAt!.toISOString(),
        status: row.status,
        error: row.error,
        permalink: row.permalink,
      };
    }),
  );

  return json({ posts });
};

// Cancela una publicación pendiente o fallida.
export const DELETE: APIRoute = async (context) => {
  const userId = context.locals.user!.id;
  let body: { id?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body.id) return json({ error: "bad_request" }, 400);

  const post = await db.query.scheduledPost.findFirst({
    where: and(eq(scheduledPost.id, body.id), eq(scheduledPost.userId, userId)),
  });
  if (!post) return json({ error: "not_found" }, 404);
  if (post.status !== "pending" && post.status !== "failed") {
    return json({ error: "not_cancelable" }, 409);
  }

  await db
    .update(scheduledPost)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(scheduledPost.id, post.id));
  return json({ ok: true });
};

// Reintenta una publicación fallida: vuelve a la cola para el próximo tick.
export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;
  let body: { id?: string; action?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body.id || body.action !== "retry") {
    return json({ error: "bad_request" }, 400);
  }

  const post = await db.query.scheduledPost.findFirst({
    where: and(eq(scheduledPost.id, body.id), eq(scheduledPost.userId, userId)),
  });
  if (!post) return json({ error: "not_found" }, 404);
  if (post.status !== "failed") return json({ error: "not_retryable" }, 409);

  const now = new Date();
  await db
    .update(scheduledPost)
    .set({
      status: "pending",
      attempts: 0,
      error: null,
      scheduledAt: now,
      updatedAt: now,
    })
    .where(eq(scheduledPost.id, post.id));
  return json({ ok: true });
};
