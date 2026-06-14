// Scheduler en proceso para las publicaciones programadas.
//
// Se arranca como efecto de módulo (lo importa src/middleware.ts) igual que
// src/lib/db.ts aplica las migraciones al cargar. Un setInterval revisa cada
// minuto la tabla `scheduled_post` y publica lo que ha vencido. Pensado para
// una sola instancia (Railway); no es un sistema de colas distribuido.

import { and, eq, lte } from "drizzle-orm";
import { db } from "./db";
import { instagramAccount, scheduledPost } from "../db/schema";
import { MetaApiError, refreshLongLivedToken } from "./instagram";
import { PublishError, publishToInstagram } from "./publish";

const TICK_MS = 60 * 1000; // cada minuto
const MAX_ATTEMPTS = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Evita arrancar dos veces (HMR de dev / dobles imports).
const FLAG = "__igSchedulerStarted" as const;
const globalAny = globalThis as unknown as Record<string, boolean>;

let running = false; // evita que dos ticks se solapen

/** Refresca el token largo si le quedan menos de 7 días. Devuelve el vigente. */
async function ensureFreshToken(account: {
  userId: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
}): Promise<string> {
  const expiresIn = account.tokenExpiresAt
    ? account.tokenExpiresAt.getTime() - Date.now()
    : Infinity;
  if (expiresIn > WEEK_MS) return account.accessToken;
  try {
    const now = new Date();
    const { accessToken, expiresAt } = await refreshLongLivedToken(
      account.accessToken,
    );
    await db
      .update(instagramAccount)
      .set({
        accessToken,
        tokenExpiresAt: expiresAt,
        tokenRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(instagramAccount.userId, account.userId));
    return accessToken;
  } catch (err) {
    // Si el refresco falla seguimos con el token actual; si está caducado,
    // publishToInstagram lanzará un MetaApiError de auth y se marcará para
    // reconectar.
    if (!(err instanceof MetaApiError)) console.error("[scheduler] refresh", err);
    return account.accessToken;
  }
}

async function publishOne(post: typeof scheduledPost.$inferSelect): Promise<void> {
  const account = await db.query.instagramAccount.findFirst({
    where: eq(instagramAccount.userId, post.userId),
  });

  if (!account) {
    await db
      .update(scheduledPost)
      .set({ status: "failed", error: "not_connected", updatedAt: new Date() })
      .where(eq(scheduledPost.id, post.id));
    return;
  }

  try {
    const accessToken = await ensureFreshToken(account);
    const { mediaId, permalink } = await publishToInstagram(
      post.userId,
      { accessToken, igUserId: account.igUserId },
      post.storageKeys,
      post.caption,
    );
    await db
      .update(scheduledPost)
      .set({
        status: "published",
        igMediaId: mediaId,
        permalink,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPost.id, post.id));
  } catch (err) {
    console.error("[scheduler] publish", post.id, err);
    const isAuth = err instanceof MetaApiError && err.isAuthError;
    const attempts = post.attempts + 1;
    const code =
      err instanceof PublishError
        ? err.code
        : err instanceof MetaApiError
          ? "meta_error"
          : "unknown";

    if (isAuth) {
      await db
        .update(scheduledPost)
        .set({ status: "failed", error: "reconnect", attempts, updatedAt: new Date() })
        .where(eq(scheduledPost.id, post.id));
    } else if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(scheduledPost)
        .set({ status: "failed", error: code, attempts, updatedAt: new Date() })
        .where(eq(scheduledPost.id, post.id));
    } else {
      // Vuelve a la cola; el próximo tick lo reintenta.
      await db
        .update(scheduledPost)
        .set({ status: "pending", error: code, attempts, updatedAt: new Date() })
        .where(eq(scheduledPost.id, post.id));
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await db.query.scheduledPost.findMany({
      where: and(
        eq(scheduledPost.status, "pending"),
        lte(scheduledPost.scheduledAt, new Date()),
      ),
      limit: 5,
    });

    for (const post of due) {
      // Claim atómico: solo lo procesa quien consiga pasarlo a 'publishing'.
      const claim = db
        .update(scheduledPost)
        .set({ status: "publishing", updatedAt: new Date() })
        .where(
          and(eq(scheduledPost.id, post.id), eq(scheduledPost.status, "pending")),
        )
        .run();
      if (claim.changes !== 1) continue;

      await publishOne(post);
    }
  } catch (err) {
    console.error("[scheduler] tick", err);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (globalAny[FLAG]) return;
  globalAny[FLAG] = true;

  // Recupera posts que quedaron a medias por un reinicio: los marcamos como
  // fallidos (no se reintentan solos para no arriesgar una doble publicación;
  // el usuario los reintenta desde la cola).
  db.update(scheduledPost)
    .set({ status: "failed", error: "interrumpido", updatedAt: new Date() })
    .where(eq(scheduledPost.status, "publishing"))
    .run();

  setInterval(() => {
    void tick();
  }, TICK_MS).unref?.();

  console.log("[scheduler] iniciado (cada", TICK_MS / 1000, "s)");
}

startScheduler();
