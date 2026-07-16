// FUENTE DE VERDAD del contrato de los posts del portafolio (colección `blogs`
// en la Mongo de portfolio_2025). Espejo del modelo Mongoose
// portfolio_2025/server/models/Blog.ts: si cambias campos aquí, actualiza ese
// modelo en el mismo cambio (y viceversa).
//
// Excepciones deliberadas de este gestor (distinto de lo que hace Mongoose):
//   - `status` entra como "draft" por defecto: nada se publica sin acción
//     explícita (misma filosofía que `visible: false` en las imágenes).
//   - NO se escribe `__v` ni `author` (este último está comentado en el modelo).
//   - Fechas SIEMPRE `Date`, nunca strings.
//   - Los bloques `image`/`slide` guardan `url` (NO `imageUrl`) y no denormalizan
//     EXIF/metadata: el sitio enriquece caption/footer/EXIF desde `images` al leer.
//   - `file` queda fuera a propósito (ArticleRender lo marca "no soportado").
//   - El `order` de cada bloque NO viaja en la entrada: la capa Mongo lo recalcula
//     0..n según la posición en el arreglo al guardar.

import { z } from "zod";

const trimmed = z.string().trim();

export const blogStatusSchema = z.enum(["draft", "published", "archived"]);
export const blogTypeSchema = z.enum(["blog", "repo"]);

// Slug público del post: solo minúsculas, números y guiones (mismo match que el
// modelo Mongoose). Un string vacío se trata como "autogenerar" aguas arriba.
export const blogSlugSchema = trimmed.regex(/^[a-z0-9-]+$/);

// --- Bloques de contenido (espejo de content[] en Blog.ts / ArticleRender.vue) ---

const textBlockSchema = z.object({
  type: z.literal("text"),
  // HTML crudo: el sitio lo pinta con v-html. Se sanitiza en el server (allowlist).
  value: z.string(),
});

const imageBlockSchema = z.object({
  type: z.literal("image"),
  // El sitio lee `url` (BlogImageCard :imageUrl="block.url") y enriquece el resto
  // desde la colección `images`. Solo guardamos url + caption/footer editoriales.
  url: trimmed.min(1),
  caption: trimmed.optional(),
  caption_en: trimmed.optional(),
  footer: trimmed.optional(),
  footer_en: trimmed.optional(),
});

const videoBlockSchema = z.object({
  type: z.literal("video"),
  // src del iframe (embed de YouTube/Vimeo).
  videoUrl: trimmed.min(1),
});

const slideItemSchema = z.object({
  url: trimmed.min(1),
  caption: trimmed.optional(),
  caption_en: trimmed.optional(),
  footer: trimmed.optional(),
  footer_en: trimmed.optional(),
});

const slideBlockSchema = z.object({
  type: z.literal("slide"),
  slides: z.array(slideItemSchema).min(1),
});

const codeBlockSchema = z.object({
  type: z.literal("code"),
  // El sitio muestra `value` en <pre><code>. `language` se guarda (parte del
  // contrato) aunque ArticleRender no resalte sintaxis todavía.
  value: z.string(),
  language: trimmed.optional(),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  imageBlockSchema,
  videoBlockSchema,
  slideBlockSchema,
  codeBlockSchema,
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

// --- Documento editable (lo que aceptan POST crear / PUT actualizar) ---

export const blogInputSchema = z
  .object({
    title: trimmed.min(1).max(200),
    // Si falta (o llega vacío), se autogenera del título aguas arriba.
    slug: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      blogSlugSchema.optional(),
    ),
    excerpt: trimmed.min(1).max(500),
    description: trimmed.max(1000).optional(),
    status: blogStatusSchema.default("draft"),
    type: blogTypeSchema.default("blog"),
    mainImage: trimmed.min(1),
    // Solo para repos (la UI los muestra si type === "repo"); opcionales igual.
    githubUrl: trimmed.min(1).optional(),
    demoUrl: trimmed.min(1).optional(),
    technologies: z.array(trimmed.min(1)).optional(),
    content: z.array(contentBlockSchema).default([]),
    tags: z.array(trimmed.min(1)).default([]),
    // Llega como string ISO desde el cliente → Date. El server lo autocompleta
    // antes de validar cuando el post pasa a "published".
    publishedAt: z.coerce.date().optional(),
  })
  // Un post publicado SIEMPRE tiene fecha (el sitio ordena por publishedAt). El
  // server la rellena antes de validar; esto es la red de seguridad.
  .refine((b) => b.status !== "published" || b.publishedAt != null, {
    message: "published_requires_date",
    path: ["publishedAt"],
  });

export type BlogInput = z.infer<typeof blogInputSchema>;

/**
 * Bloque tal como lo consume el EDITOR (lectura). Es laxo a propósito: los 3
 * posts legacy traen `imageUrl` en vez de `url`, `order`, `imageData`, etc. La
 * capa Mongo normaliza a esta forma (imageUrl→url, orden por posición) y el
 * editor devuelve bloques que el schema estricto de arriba valida al guardar.
 */
export interface EditorBlock {
  type: "text" | "image" | "video" | "slide" | "code";
  value?: string;
  url?: string;
  videoUrl?: string;
  language?: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
  slides?: Array<{
    url: string;
    caption?: string;
    caption_en?: string;
    footer?: string;
    footer_en?: string;
  }>;
}

/**
 * Doc crudo de la colección `blogs` al LEER. Laxo (índice de string) porque los
 * posts legacy traen campos fuera del contrato actual (author, __v, imageData,
 * subType, imageUrl en bloques…). No parseamos con Zod al leer: se normaliza a
 * mano (ver portfolioBlogDb).
 */
export interface BlogDoc {
  _id?: unknown;
  title: string;
  slug: string;
  excerpt?: string;
  description?: string;
  status: "draft" | "published" | "archived";
  type?: "blog" | "repo";
  mainImage?: string;
  images?: string[];
  githubUrl?: string;
  demoUrl?: string;
  technologies?: string[];
  content?: unknown[];
  tags?: string[];
  publishedAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  [key: string]: unknown;
}
