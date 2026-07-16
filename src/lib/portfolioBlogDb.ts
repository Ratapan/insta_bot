// Acceso a la colección `blogs` de la Mongo del portafolio (driver nativo, sin
// Mongoose, igual que portfolioDb). Maneja AMBOS tipos: type "blog" y "repo"
// (los repos del sitio viven en esta misma colección). La colección `repos` es
// legacy sin lector — NO se toca.
//
// El contrato vive en portfolioBlogSchema.ts (Zod, fuente de verdad frente a
// Blog.ts). Como no usamos Mongoose, van a mano:
//   - Timestamps: `updatedAt` en cada escritura, `createdAt` solo al insertar.
//   - publishedAt: se setea la PRIMERA vez que el post pasa a "published" (si no
//     tenía); nunca se borra al despublicar. El server lo resuelve ANTES de
//     validar (así el refine "published ⇒ fecha" siempre pasa).
//   - `order` de los bloques: recalculado 0..n por posición al guardar.
//   - Los posts legacy (imageUrl en bloques, fechas string, sin `type`) se
//     toleran al leer y se normalizan al guardar.

import type { Collection, OptionalUnlessRequiredId } from "mongodb";
import sanitizeHtml from "sanitize-html";
import { getDb } from "./portfolioDb";
import { ensureUniqueSlug, slugify } from "./slug";
import {
  blogInputSchema,
  type BlogDoc,
  type BlogInput,
  type ContentBlock,
  type EditorBlock,
} from "./portfolioBlogSchema";

export type { BlogDoc, EditorBlock };

async function getBlogsCollection(): Promise<Collection<BlogDoc>> {
  return (await getDb()).collection<BlogDoc>("blogs");
}

// Allowlist acotada para el HTML de los bloques `text` (el sitio hace v-html).
// Nada de <script>, <img>, <style>, on*=, etc.: solo formato editorial básico.
const ALLOWED_TAGS = [
  "p",
  "br",
  "a",
  "strong",
  "em",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
];

function sanitizeBlockHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

/** Prepara los bloques para Mongo: sanitiza el HTML y recalcula `order` 0..n. */
function prepareContent(blocks: ContentBlock[]): unknown[] {
  return blocks.map((block, order) => {
    if (block.type === "text") {
      return { ...block, value: sanitizeBlockHtml(block.value), order };
    }
    return { ...block, order };
  });
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// --- Lectura -----------------------------------------------------------------

export interface ListBlogsQuery {
  type?: "blog" | "repo";
  status?: "draft" | "published" | "archived";
  search?: string;
}

/** Lista posts (más recientemente editados primero) con filtros opcionales. */
export async function listBlogs(query: ListBlogsQuery = {}): Promise<BlogDoc[]> {
  const col = await getBlogsCollection();
  const filter: Record<string, unknown> = {};

  // Igual que el sitio: los blogs legacy pueden no tener `type` → cuentan como blog.
  if (query.type === "blog") {
    filter.$or = [{ type: "blog" }, { type: { $exists: false } }];
  } else if (query.type === "repo") {
    filter.type = "repo";
  }
  if (query.status) filter.status = query.status;
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  return col
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .toArray();
}

export interface BlogSummary {
  slug: string;
  title: string;
  type: "blog" | "repo";
  status: "draft" | "published" | "archived";
  excerpt: string;
  mainImage: string;
  publishedAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date | null;
}

/** Lista proyectada para la vista de gestión (sin el content[] pesado). */
export async function listBlogSummaries(
  query: ListBlogsQuery = {},
): Promise<BlogSummary[]> {
  const docs = await listBlogs(query);
  return docs.map((d) => ({
    slug: d.slug,
    title: d.title ?? "",
    type: d.type ?? "blog",
    status: d.status ?? "draft",
    excerpt: d.excerpt ?? "",
    mainImage: d.mainImage ?? "",
    publishedAt: toDate(d.publishedAt),
    updatedAt: toDate(d.updatedAt),
    createdAt: toDate(d.createdAt),
  }));
}

export async function findBlogBySlug(slug: string): Promise<BlogDoc | null> {
  const col = await getBlogsCollection();
  return col.findOne({ slug });
}

/** Normaliza un bloque legacy a la forma laxa que consume el editor. */
function normalizeBlock(raw: unknown): EditorBlock | null {
  const b = raw as Record<string, unknown>;
  const type = b?.type;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const opt = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;

  if (type === "text") return { type, value: str(b.value) };
  if (type === "image") {
    return {
      type,
      url: str(b.url ?? b.imageUrl), // legacy: imageUrl → url
      caption: opt(b.caption),
      caption_en: opt(b.caption_en),
      footer: opt(b.footer),
      footer_en: opt(b.footer_en),
    };
  }
  if (type === "video") return { type, videoUrl: str(b.videoUrl) };
  if (type === "code") {
    return { type, value: str(b.value), language: opt(b.language) };
  }
  if (type === "slide") {
    const slides = Array.isArray(b.slides) ? b.slides : [];
    return {
      type,
      slides: slides
        .map((s) => {
          const item = s as Record<string, unknown>;
          return {
            url: str(item.url ?? item.imageUrl),
            caption: opt(item.caption),
            caption_en: opt(item.caption_en),
            footer: opt(item.footer),
            footer_en: opt(item.footer_en),
          };
        })
        .filter((s) => s.url !== ""),
    };
  }
  // `file` u otros tipos no editables: los descartamos (ver nota de fase).
  return null;
}

export interface EditorBlog {
  title: string;
  slug: string;
  excerpt: string;
  description: string;
  status: "draft" | "published" | "archived";
  type: "blog" | "repo";
  mainImage: string;
  githubUrl: string;
  demoUrl: string;
  technologies: string[];
  content: EditorBlock[];
  tags: string[];
  publishedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Señala si el post traía bloques no editables (p. ej. `file`) que se omiten. */
  droppedBlocks: number;
}

/** Adapta un doc (incluida forma legacy) a lo que rellena el editor. */
export function normalizeBlogForEditor(doc: BlogDoc): EditorBlog {
  const rawContent = Array.isArray(doc.content) ? doc.content : [];
  const ordered = [...rawContent].sort((a, b) => {
    const oa = (a as { order?: number })?.order ?? 0;
    const ob = (b as { order?: number })?.order ?? 0;
    return oa - ob;
  });
  const content = ordered
    .map(normalizeBlock)
    .filter((b): b is EditorBlock => b !== null);

  return {
    title: doc.title ?? "",
    slug: doc.slug ?? "",
    excerpt: doc.excerpt ?? "",
    description: doc.description ?? "",
    status: doc.status ?? "draft",
    type: doc.type ?? "blog",
    mainImage: doc.mainImage ?? "",
    githubUrl: doc.githubUrl ?? "",
    demoUrl: doc.demoUrl ?? "",
    technologies: doc.technologies ?? [],
    content,
    tags: doc.tags ?? [],
    publishedAt: toDate(doc.publishedAt),
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt),
    droppedBlocks: ordered.length - content.length,
  };
}

// --- Escritura ---------------------------------------------------------------

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: number }).code === 11000
  );
}

async function slugTaken(slug: string): Promise<boolean> {
  const col = await getBlogsCollection();
  return (await col.findOne({ slug }, { projection: { _id: 1 } })) !== null;
}

/**
 * Rellena `publishedAt` ANTES de validar: al publicar sin fecha se pone ahora;
 * si ya la tenía (o el doc existente la tenía) se conserva — nunca se borra.
 */
function withResolvedPublishedAt(
  raw: unknown,
  existing: Date | null,
): unknown {
  const r = (raw ?? {}) as Record<string, unknown>;
  const status = r.status ?? "draft";
  let publishedAt = r.publishedAt ?? existing ?? undefined;
  if (status === "published" && publishedAt == null) publishedAt = new Date();
  return { ...r, publishedAt };
}

function parseBlogInput(raw: unknown): BlogInput {
  const parsed = blogInputSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[portfolioBlogDb] invalid_fields", parsed.error.issues);
    throw new Error("invalid_fields");
  }
  return parsed.data;
}

/** Campos editables a escribir ($set), sin los `undefined`. */
function buildSet(input: BlogInput, slug: string): Record<string, unknown> {
  const set: Record<string, unknown> = {
    title: input.title,
    slug,
    excerpt: input.excerpt,
    status: input.status,
    type: input.type,
    mainImage: input.mainImage,
    content: prepareContent(input.content),
    tags: input.tags,
  };
  if (input.description !== undefined) set.description = input.description;
  if (input.githubUrl !== undefined) set.githubUrl = input.githubUrl;
  if (input.demoUrl !== undefined) set.demoUrl = input.demoUrl;
  if (input.technologies !== undefined) set.technologies = input.technologies;
  if (input.publishedAt !== undefined) set.publishedAt = input.publishedAt;
  return set;
}

// Campos opcionales que, si NO vienen, se limpian del doc (un blog no debe
// arrastrar githubUrl de cuando fue repo, etc.). `publishedAt` NUNCA se limpia.
const CLEARABLE = ["description", "githubUrl", "demoUrl", "technologies"] as const;

/**
 * Crea un post. Slug: si viene manual y ya existe → `slug_taken`; si no viene,
 * se autogenera del título con sufijos. Codes: `invalid_fields`, `slug_taken`.
 */
export async function createBlog(raw: unknown): Promise<BlogDoc> {
  const input = parseBlogInput(withResolvedPublishedAt(raw, null));
  const col = await getBlogsCollection();

  let slug: string;
  if (input.slug) {
    if (await slugTaken(input.slug)) throw new Error("slug_taken");
    slug = input.slug;
  } else {
    slug = await ensureUniqueSlug(slugify(input.title) || "post", slugTaken);
  }

  const now = new Date();
  const set = buildSet(input, slug);
  // buildSet siempre incluye title/slug/status/…; el cast concilia que `set` sea
  // Record<string, unknown> con lo que exige el tipado del driver.
  const insertDoc = {
    ...set,
    createdAt: now,
    updatedAt: now,
  } as unknown as OptionalUnlessRequiredId<BlogDoc>;
  try {
    await col.insertOne(insertDoc);
  } catch (err) {
    if (isDuplicateKey(err)) throw new Error("slug_taken"); // carrera con el índice único
    throw err;
  }

  const created = await col.findOne({ slug });
  if (!created) throw new Error("El insert no devolvió el documento");
  return created;
}

/**
 * Actualiza un post existente (nunca crea: 404 → `not_found`). Normaliza la
 * forma legacy (reescribe content con `url`, fechas Date, order 0..n). El slug
 * puede cambiar; si el nuevo choca con otro post → `slug_taken`.
 */
export async function updateBlogBySlug(
  currentSlug: string,
  raw: unknown,
): Promise<BlogDoc> {
  const col = await getBlogsCollection();
  const existing = await col.findOne({ slug: currentSlug });
  if (!existing) throw new Error("not_found");

  const input = parseBlogInput(
    withResolvedPublishedAt(raw, toDate(existing.publishedAt)),
  );

  let newSlug = existing.slug;
  if (input.slug && input.slug !== existing.slug) {
    if (await slugTaken(input.slug)) throw new Error("slug_taken");
    newSlug = input.slug;
  }

  const now = new Date();
  const set = buildSet(input, newSlug);
  set.updatedAt = now;
  // Normaliza createdAt legacy (string) → Date preservando el instante original.
  const createdAt = toDate(existing.createdAt);
  if (createdAt) set.createdAt = createdAt;

  const unset: Record<string, ""> = {};
  for (const key of CLEARABLE) {
    if (set[key] === undefined) unset[key] = "";
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;

  try {
    await col.updateOne({ slug: currentSlug }, update);
  } catch (err) {
    if (isDuplicateKey(err)) throw new Error("slug_taken");
    throw err;
  }

  const updated = await col.findOne({ slug: newSlug });
  if (!updated) throw new Error("El update no devolvió el documento");
  return updated;
}

export async function deleteBlogBySlug(slug: string): Promise<boolean> {
  const col = await getBlogsCollection();
  const result = await col.deleteOne({ slug });
  return result.deletedCount === 1;
}
