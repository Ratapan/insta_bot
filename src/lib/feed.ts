// Helpers del planificador de feed. Los huecos del grid y las publicaciones
// programadas comparten la tabla `scheduled_post`: un 'draft' es un hueco
// colocado en el grid (sin fecha) y un 'pending' es uno ya programado.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { scheduledPost } from "../db/schema";
import { getPresignedUrl } from "./storage";

// Estados que se muestran en el grid del planificador (encima de las publicadas).
export const PLAN_STATUSES = ["draft", "pending", "failed"] as const;

export interface PlanTile {
  id: string;
  /** Clave R2 de la portada; el cliente la usa para generar el caption. */
  storageKey: string;
  coverUrl: string | null;
  imageCount: number;
  caption: string;
  status: string;
  scheduledAt: string | null;
  position: number;
}

/** Siguiente posición libre en el grid (al final) para el usuario. */
export async function nextPosition(userId: string): Promise<number> {
  const rows = await db.query.scheduledPost.findMany({
    where: and(
      eq(scheduledPost.userId, userId),
      inArray(scheduledPost.status, [...PLAN_STATUSES]),
    ),
    columns: { position: true },
  });
  return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
}

/** Convierte una fila en un tile del grid, firmando la portada (1ª imagen). */
export async function planTile(
  userId: string,
  row: typeof scheduledPost.$inferSelect,
): Promise<PlanTile> {
  let coverUrl: string | null = null;
  try {
    coverUrl = await getPresignedUrl(userId, row.storageKeys[0]);
  } catch {
    // La imagen pudo borrarse de la biblioteca; sin portada.
  }
  return {
    id: row.id,
    storageKey: row.storageKeys[0],
    coverUrl,
    imageCount: row.storageKeys.length,
    caption: row.caption,
    status: row.status,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    position: row.position,
  };
}
