import type { APIRoute } from "astro";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount, scheduledPost } from "../../../db/schema";
import { PLAN_STATUSES, nextPosition, planTile } from "../../../lib/feed";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Tiles planeados del grid: borradores + programados + fallidos, en orden.
export const GET: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  const rows = await db.query.scheduledPost.findMany({
    where: and(
      eq(scheduledPost.userId, userId),
      inArray(scheduledPost.status, [...PLAN_STATUSES]),
    ),
    orderBy: [asc(scheduledPost.position)],
  });

  const tiles = await Promise.all(rows.map((row) => planTile(userId, row)));
  return json({ tiles });
};

export const POST: APIRoute = async (context) => {
  const userId = context.locals.user!.id;

  let body: {
    action?: string;
    storageKey?: string;
    order?: string[];
    id?: string;
    caption?: string;
    scheduledAt?: string;
  };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const action = body.action ?? "add";

  // --- Añadir un borrador (imagen suelta) al final del grid ---
  if (action === "add") {
    const storageKey = (body.storageKey ?? "").trim();
    if (!storageKey) return json({ error: "no_images" }, 400);

    const now = new Date();
    const id = crypto.randomUUID();
    await db.insert(scheduledPost).values({
      id,
      userId,
      storageKeys: [storageKey],
      caption: "",
      scheduledAt: null,
      status: "draft",
      position: await nextPosition(userId),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    const row = await db.query.scheduledPost.findFirst({
      where: eq(scheduledPost.id, id),
    });
    return json({ tile: await planTile(userId, row!) }, 201);
  }

  // --- Reordenar el grid: `order` es la lista de ids en su nuevo orden ---
  if (action === "reorder") {
    const order = body.order;
    if (!Array.isArray(order)) return json({ error: "bad_request" }, 400);

    const rows = await db.query.scheduledPost.findMany({
      where: and(
        eq(scheduledPost.userId, userId),
        inArray(scheduledPost.status, [...PLAN_STATUSES]),
      ),
      columns: { id: true },
    });
    const owned = new Set(rows.map((r) => r.id));
    if (!order.every((id) => owned.has(id))) {
      return json({ error: "bad_request" }, 400);
    }

    const now = new Date();
    for (let i = 0; i < order.length; i++) {
      await db
        .update(scheduledPost)
        .set({ position: i, updatedAt: now })
        .where(eq(scheduledPost.id, order[i]));
    }
    return json({ ok: true });
  }

  // --- Programar un borrador: fija fecha y caption, pasa a 'pending' ---
  if (action === "schedule") {
    if (!body.id) return json({ error: "bad_request" }, 400);

    const caption = (body.caption ?? "").trim();
    if (!caption) return json({ error: "bad_request" }, 400);
    if (caption.length > 2200) return json({ error: "caption_too_long" }, 400);

    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return json({ error: "bad_request" }, 400);
    }
    // Margen de 30s para tolerar el desfase de reloj/latencia del formulario.
    if (scheduledAt.getTime() < Date.now() - 30_000) {
      return json({ error: "schedule_in_past" }, 400);
    }

    const post = await db.query.scheduledPost.findFirst({
      where: and(
        eq(scheduledPost.id, body.id),
        eq(scheduledPost.userId, userId),
      ),
    });
    if (!post) return json({ error: "not_found" }, 404);
    if (post.status !== "draft" && post.status !== "failed") {
      return json({ error: "not_schedulable" }, 409);
    }

    const account = await db.query.instagramAccount.findFirst({
      where: eq(instagramAccount.userId, userId),
    });
    if (!account) return json({ error: "not_connected" }, 409);

    const now = new Date();
    await db
      .update(scheduledPost)
      .set({
        status: "pending",
        caption,
        scheduledAt,
        attempts: 0,
        error: null,
        updatedAt: now,
      })
      .where(eq(scheduledPost.id, post.id));
    return json({ ok: true, scheduledAt: scheduledAt.toISOString() });
  }

  return json({ error: "bad_request" }, 400);
};

// Quita un tile: borra el borrador; cancela un programado/fallido.
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

  if (post.status === "draft") {
    await db.delete(scheduledPost).where(eq(scheduledPost.id, post.id));
    return json({ ok: true });
  }
  if (post.status === "pending" || post.status === "failed") {
    await db
      .update(scheduledPost)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(scheduledPost.id, post.id));
    return json({ ok: true });
  }
  return json({ error: "not_cancelable" }, 409);
};
