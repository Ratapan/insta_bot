// Motor del lote de catalogación (Fase 3): un job en memoria que recorre las
// imágenes elegidas por tandas de 6-8 dentro de UNA conversación con Claude
// (createPortfolioBatchConversation), valida las categorías propuestas contra
// el vocabulario (tags + categorías en uso) y va acumulando propuestas que la
// UI consulta por polling. Nada se escribe en Mongo aquí: aplicar las
// propuestas es decisión del dueño, campo a campo, desde el panel de revisión.
//
// Las imágenes se leen por su URL pública (bucket público del portafolio), no
// por el SDK de R2: el lote funciona sin las credenciales PORTFOLIO_R2_*.
//
// Un solo job a la vez (app de un usuario); se conserva el último 30 min.

import { db } from "./db";
import { generationLog } from "../db/schema";
import {
  CaptionGenerationError,
  createPortfolioBatchConversation,
  normalizeImageForClaude,
  type BatchImageInput,
} from "./claude";
import {
  distinctCategories,
  findImagesByUrls,
  findSessionByName,
  listTags,
  type PortfolioImage,
} from "./portfolioDb";

const CHUNK_MAX = 8; // tandas de 6-8; el empaquetado no parte series si caben
const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const JOB_TTL_MS = 30 * 60 * 1000;

export interface BatchProposal {
  url: string;
  file: string;
  caption: string;
  caption_en: string;
  footer: string;
  footer_en: string;
  /** Todas las categorías propuestas, en minúsculas, la primera es la principal. */
  categories: string[];
  /** Las que NO están en el vocabulario: la UI las ofrece como sugerencias. */
  unknownCategories: string[];
}

export interface BatchJob {
  id: string;
  status: "running" | "done" | "error";
  /** Código de error string si status === "error" (puede haber propuestas parciales). */
  error?: string;
  total: number;
  done: number;
  proposals: BatchProposal[];
  /** Archivos que no se pudieron leer/procesar y quedaron fuera. */
  skipped: string[];
  createdAt: number;
}

let currentJob: BatchJob | null = null;

/** El job vigente (el último), o null si expiró. */
export function getBatchJob(id: string): BatchJob | null {
  if (!currentJob || currentJob.id !== id) return null;
  if (Date.now() - currentJob.createdAt > JOB_TTL_MS) {
    currentJob = null;
    return null;
  }
  return currentJob;
}

export function hasRunningBatchJob(): boolean {
  return currentJob?.status === "running";
}

async function fetchPublicImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_FETCH_BYTES) throw new Error("imagen demasiado grande");
  return buffer;
}

/**
 * Ordena el lote agrupando los miembros de cada serie (por `order`) y lo parte
 * en tandas de hasta CHUNK_MAX sin separar una serie, salvo que ella sola no
 * quepa en una tanda.
 */
function packChunks(docs: PortfolioImage[]): PortfolioImage[][] {
  const groups: PortfolioImage[][] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.url)) continue;
    if (doc.series) {
      const id = doc.series.id;
      const members = docs
        .filter((d) => d.series?.id === id)
        .sort((a, b) => (a.series?.order ?? 0) - (b.series?.order ?? 0));
      for (const m of members) seen.add(m.url);
      groups.push(members);
    } else {
      seen.add(doc.url);
      groups.push([doc]);
    }
  }

  const chunks: PortfolioImage[][] = [];
  let chunk: PortfolioImage[] = [];
  for (const group of groups) {
    if (chunk.length > 0 && chunk.length + group.length > CHUNK_MAX) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...group);
    // Serie más grande que una tanda: se parte igual (caso raro).
    while (chunk.length > CHUNK_MAX) {
      chunks.push(chunk.slice(0, CHUNK_MAX));
      chunk = chunk.slice(CHUNK_MAX);
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/** Sesión de un doc: el campo si existe, si no la carpeta de la key. */
function sessionOf(doc: PortfolioImage): string | null {
  if (doc.session) return doc.session;
  const m = doc.url.match(/\/blog\/images\/([^/]+)\//);
  return m?.[1] ?? null;
}

/**
 * Arranca el lote y devuelve el job de inmediato; el procesamiento sigue en
 * background y la UI lo sigue con getBatchJob. Lanza códigos string si no se
 * puede arrancar ("batch_running", "not_found").
 */
export async function startBatchJob(
  userId: string,
  urls: string[],
): Promise<BatchJob> {
  if (hasRunningBatchJob()) throw new Error("batch_running");

  const byUrl = await findImagesByUrls(urls);
  const docs = urls
    .map((u) => byUrl.get(u))
    .filter((d): d is PortfolioImage => d !== undefined);
  if (docs.length === 0) throw new Error("not_found");

  // Contexto: el de cada sesión presente en el lote (si lo hay en Mongo).
  const sessionNames = [
    ...new Set(docs.map(sessionOf).filter((s): s is string => s !== null)),
  ];
  const contexts: string[] = [];
  for (const name of sessionNames) {
    const ses = await findSessionByName(name).catch(() => null);
    if (ses?.context?.trim()) contexts.push(`Sesión ${name}: ${ses.context.trim()}`);
  }

  // Vocabulario: tags del vocabulario controlado + categorías ya en uso.
  const [tags, inUse] = await Promise.all([
    listTags().catch(() => []),
    distinctCategories().catch(() => []),
  ]);
  const vocabulary = [
    ...new Set([...tags.map((t) => t.name.toLowerCase()), ...inUse.map((c) => c.toLowerCase())]),
  ].sort();

  const job: BatchJob = {
    id: crypto.randomUUID(),
    status: "running",
    total: docs.length,
    done: 0,
    proposals: [],
    skipped: [],
    createdAt: Date.now(),
  };
  currentJob = job;

  void runBatchJob(job, userId, docs, contexts.join("\n"), vocabulary).catch((err) => {
    console.error("[portfolioBatch] job crashed", err);
    job.status = "error";
    job.error ??= "unknown";
  });

  return job;
}

async function runBatchJob(
  job: BatchJob,
  userId: string,
  docs: PortfolioImage[],
  sessionContext: string,
  vocabulary: string[],
) {
  const vocabularySet = new Set(vocabulary);
  const conversation = createPortfolioBatchConversation({
    sessionContext: sessionContext || undefined,
    vocabulary,
  });

  // Etiquetas legibles por serie (A, B, …) para la nota junto a cada imagen.
  const seriesLabels = new Map<string, string>();
  for (const doc of docs) {
    if (doc.series && !seriesLabels.has(doc.series.id)) {
      seriesLabels.set(doc.series.id, String.fromCharCode(65 + seriesLabels.size));
    }
  }

  try {
    for (const chunk of packChunks(docs)) {
      // Descarga + normalización; lo que falle queda fuera de la tanda.
      const inputs: { doc: PortfolioImage; input: BatchImageInput }[] = [];
      for (const doc of chunk) {
        try {
          const buffer = await fetchPublicImage(doc.url);
          const { base64, mediaType } = await normalizeImageForClaude(buffer);
          let seriesNote: string | undefined;
          if (doc.series) {
            const size = docs.filter((d) => d.series?.id === doc.series?.id).length;
            seriesNote = `Serie ${seriesLabels.get(doc.series.id)}, posición ${doc.series.order + 1} de ${size}`;
          }
          inputs.push({
            doc,
            input: {
              file: doc.file,
              imageBase64: base64,
              imageMediaType: mediaType,
              seriesNote,
            },
          });
        } catch (err) {
          console.warn(`[portfolioBatch] imagen omitida: ${doc.file}`, err);
          job.skipped.push(doc.file);
          job.done += 1;
        }
      }
      if (inputs.length === 0) continue;

      const items = await conversation.next(inputs.map((i) => i.input));
      for (const [i, item] of items.entries()) {
        const doc = inputs[i]!.doc;
        job.proposals.push({
          url: doc.url,
          file: doc.file,
          caption: item.caption,
          caption_en: item.caption_en,
          footer: item.footer,
          footer_en: item.footer_en,
          categories: item.categories,
          unknownCategories: item.categories.filter((c) => !vocabularySet.has(c)),
        });
        job.done += 1;
      }
    }

    // Registro para iterar el prompt después (misma tabla que el resto).
    await db.insert(generationLog).values({
      id: crypto.randomUUID(),
      userId,
      source: "portfolio_batch",
      igMediaId: null,
      context: sessionContext || null,
      tone: null,
      withHashtags: false,
      options: {
        total: job.total,
        proposals: job.proposals,
        skipped: job.skipped,
        vocabularySize: vocabulary.length,
      },
      createdAt: new Date(),
    });

    job.status = "done";
  } catch (err) {
    console.error("[portfolioBatch] job error", err);
    job.status = "error";
    job.error =
      err instanceof CaptionGenerationError
        ? err.reason === "api"
          ? "claude_unavailable"
          : "claude_parse"
        : "unknown";
  }
}
