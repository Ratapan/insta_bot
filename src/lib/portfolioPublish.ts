// «Publicar sitio»: el portafolio (portfolio_2026) es HTML estático que lee
// Mongo solo al compilar, así que los cambios hechos aquí se ven recién con un
// build nuevo. Este módulo dispara ese build con el Deploy Hook de Vercel
// (PORTFOLIO_DEPLOY_HOOK_URL, secreta: quien la tenga puede lanzar deploys) y
// lleva la cuenta de lo pendiente en la colección `site_meta`:
//   { _id: "publish", lastPublishedAt?: Date, changedAt?: Date }
// Pendiente = docs de images/blogs/collections con updatedAt posterior a la
// última publicación, más `changedAt` (borrados y cambios del vocabulario, que
// no dejan updatedAt; lo escribe markSiteChanged en portfolioDb.ts).
import { getDb } from "./portfolioDb";

interface SiteMeta {
  _id: string;
  lastPublishedAt?: Date;
  changedAt?: Date;
}

export interface PublishStatus {
  configured: boolean;
  lastPublishedAt: string | null;
  /** null = nunca se publicó desde aquí (no hay contra qué comparar). */
  pending: { images: number; blogs: number; collections: number; other: boolean } | null;
}

async function metaCollection() {
  return (await getDb()).collection<SiteMeta>("site_meta");
}

export function isPublishConfigured(): boolean {
  return !!import.meta.env.PORTFOLIO_DEPLOY_HOOK_URL;
}

export async function publishStatus(): Promise<PublishStatus> {
  const db = await getDb();
  const meta = await (await metaCollection()).findOne({ _id: "publish" });
  const since = meta?.lastPublishedAt;
  if (!since) {
    return { configured: isPublishConfigured(), lastPublishedAt: null, pending: null };
  }
  const changed = { updatedAt: { $gt: since } };
  const [images, blogs, collections] = await Promise.all([
    db.collection("images").countDocuments(changed),
    db.collection("blogs").countDocuments(changed),
    db.collection("collections").countDocuments(changed),
  ]);
  return {
    configured: isPublishConfigured(),
    lastPublishedAt: since.toISOString(),
    pending: { images, blogs, collections, other: !!meta.changedAt && meta.changedAt > since },
  };
}

/**
 * Llama al Deploy Hook y guarda la hora. Lanza códigos string:
 * not_configured, publish_failed.
 */
export async function triggerPublish(): Promise<Date> {
  const hook = import.meta.env.PORTFOLIO_DEPLOY_HOOK_URL;
  if (!hook) throw new Error("not_configured");
  // La hora se toma ANTES de llamar: lo que se edite mientras compila cuenta
  // como pendiente para la próxima publicación (el build puede no incluirlo).
  const now = new Date();
  let res: Response;
  try {
    res = await fetch(hook, { method: "POST" });
  } catch (err) {
    console.error("[portfolio/publish] no se pudo llamar al Deploy Hook", err);
    throw new Error("publish_failed");
  }
  if (!res.ok) {
    console.error("[portfolio/publish] el Deploy Hook respondió", res.status, await res.text().catch(() => ""));
    throw new Error("publish_failed");
  }
  await (await metaCollection()).updateOne(
    { _id: "publish" },
    { $set: { lastPublishedAt: now } },
    { upsert: true },
  );
  return now;
}
