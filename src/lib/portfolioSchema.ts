// FUENTE DE VERDAD del contrato de datos del portafolio (colección `images`
// en la Mongo de portfolio_2025, y la futura colección `sessions`).
//
// portfolio_2025/server/models/Image.ts (Mongoose) debe reflejar este shape:
// si cambias campos aquí, actualiza ese schema en el mismo cambio (y viceversa).
//
// Invariantes que este contrato garantiza:
//   - `category` es DERIVADO: siempre `categories[0]`. No es editable; lo
//     escribe upsertImage en cada guardado. Se conserva en el doc porque el
//     portfolio lo indexa y filtra por él.
//   - Strings con trim; `categories` en minúsculas, sin vacíos ni duplicados.
//   - `stars` entero 0–5.
//   - `focal` es el string de display canónico "50 mm" (con espacio, el
//     formato de los docs existentes); `focalMm` es el número para
//     ordenar/filtrar.
//   - `session` = carpeta bajo `blog/images/` en R2 (p. ej. "260131_patrimonio").
//   - `series` agrupa dípticos/trípticos: id compartido + orden dentro de la serie.

import { z } from "zod";

const trimmed = z.string().trim();

/**
 * Nombre de sesión: es una carpeta bajo `blog/images/` en R2, así que solo
 * caracteres seguros en una key (letras, números, guion y guion bajo).
 */
export const sessionNameSchema = trimmed.regex(/^[\w-]+$/);

/** Serie a la que pertenece una imagen (díptico/tríptico). */
export const seriesSchema = z.object({
  id: trimmed.min(1),
  order: z.number().int().min(0),
});

/**
 * Campos editables desde el gestor. Todo opcional: un PATCH/PUT parcial solo
 * toca lo que viene. `category` NO está aquí a propósito (es derivado).
 * Las claves desconocidas se descartan al parsear (strip por defecto de zod).
 */
export const portfolioImageFieldsSchema = z.object({
  caption: trimmed.optional(),
  caption_en: trimmed.optional(),
  footer: trimmed.optional(),
  footer_en: trimmed.optional(),
  focal: trimmed.optional(),
  focalMm: z.number().positive().optional(),
  apertura: z.number().positive().optional(),
  iso: z.number().int().positive().optional(),
  velocidad: trimmed.optional(),
  camera: trimmed.optional(),
  lens: trimmed.optional(),
  stars: z.number().int().min(0).max(5).optional(),
  portfolio: z.boolean().optional(),
  visible: z.boolean().optional(),
  session: sessionNameSchema.nullable().optional(),
  series: seriesSchema.nullable().optional(),
  categories: z
    .array(z.string())
    .transform((arr) => [
      ...new Set(arr.map((c) => c.toLowerCase().trim()).filter(Boolean)),
    ])
    .optional(),
});

export type PortfolioImageFields = z.infer<typeof portfolioImageFieldsSchema>;

/**
 * Doc completo de la colección `images`. OJO: los 90 docs anteriores a la
 * migración de Fase 5 no tienen createdAt/updatedAt — hasta entonces, tratar
 * esos campos como posiblemente ausentes al leer.
 */
export const portfolioImageSchema = portfolioImageFieldsSchema.extend({
  url: trimmed.min(1),
  file: trimmed.min(1),
  /** Derivado: siempre categories[0]; ausente si categories está vacía. */
  category: trimmed.optional(),
  categories: z.array(z.string()),
  stars: z.number().int().min(0).max(5),
  portfolio: z.boolean(),
  visible: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PortfolioImage = z.infer<typeof portfolioImageSchema>;

/** Doc de la colección `tags`. Nombres en minúsculas (como `categories`). */
export const tagSchema = z.object({
  name: trimmed.toLowerCase().min(1),
  parent: trimmed.toLowerCase().min(1).nullable(),
});

export type Tag = z.infer<typeof tagSchema>;

/**
 * Doc de la colección `sessions` (contexto de una sesión de fotos, insumo
 * para la generación con IA). La clave `session` coincide con el campo
 * homónimo de las imágenes. Solo la lee insta_bot; el portfolio no la usa.
 */
export const portfolioSessionSchema = z.object({
  session: sessionNameSchema,
  context: trimmed,
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Entrada del upsert de una sesión (lo que acepta el PUT). */
export const portfolioSessionInputSchema = portfolioSessionSchema.pick({
  session: true,
  context: true,
});

export type PortfolioSession = z.infer<typeof portfolioSessionSchema>;
export type PortfolioSessionInput = z.infer<typeof portfolioSessionInputSchema>;
