// Acceso directo a la base MongoDB del portafolio (portfolio_2025, db en la
// URI). Usamos el driver nativo en vez de Mongoose: las escrituras son upserts
// simples por `url` único y no queremos un segundo ODM en este proyecto.
//
// El shape de los docs vive en portfolioSchema.ts (Zod, fuente de verdad del
// contrato con portfolio_2025). OJO con dos cosas que en el portfolio hace
// Mongoose y aquí van a mano:
//   1. Timestamps: cada upsert pone `updatedAt` en $set y `createdAt` en
//      $setOnInsert (el portfolio ordena por -createdAt).
//   2. Defaults: stars=0, portfolio=false, categories=[]. `visible` es la
//      excepción deliberada: aquí un insert entra con visible=false (nada se
//      publica sin revisión), aunque el default de Mongoose sea true.
//
// La conexión es perezosa (primer uso), a diferencia de db.ts que abre SQLite
// al importar: una caída de Atlas no debe impedir arrancar la app.

import { MongoClient, type Collection, type Db } from "mongodb";
import {
  portfolioImageFieldsSchema,
  portfolioSessionInputSchema,
  tagSchema,
  type PortfolioImage,
  type PortfolioImageFields,
  type PortfolioSession,
  type Tag,
} from "./portfolioSchema";

export type { PortfolioImage, PortfolioImageFields, PortfolioSession, Tag };

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  const uri = import.meta.env.PORTFOLIO_MONGODB_URI;
  if (!uri) {
    throw new Error("PORTFOLIO_MONGODB_URI no está configurada");
  }
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db();
}

async function getCollection(): Promise<Collection<PortfolioImage>> {
  return (await getDb()).collection<PortfolioImage>("images");
}

async function getSessionsCollection(): Promise<Collection<PortfolioSession>> {
  return (await getDb()).collection<PortfolioSession>("sessions");
}

async function getTagsCollection(): Promise<Collection<Tag>> {
  return (await getDb()).collection<Tag>("tags");
}

export interface ListImagesQuery {
  /** Sin valor = sin filtro (el gestor quiere ver todo, no solo lo visible). */
  portfolio?: boolean;
  visible?: boolean;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listImages(query: ListImagesQuery = {}): Promise<{
  data: PortfolioImage[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const col = await getCollection();
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));

  const filter: Record<string, unknown> = {};
  if (query.portfolio !== undefined) filter.portfolio = query.portfolio;
  if (query.visible !== undefined) filter.visible = query.visible;
  if (query.category) filter.category = query.category;
  if (query.search) {
    const rx = { $regex: query.search, $options: "i" };
    filter.$or = [
      { caption: rx },
      { footer: rx },
      { category: rx },
      { categories: rx },
      { file: rx },
    ];
  }

  const total = await col.countDocuments(filter);
  const data = await col
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** Docs de una lista de URLs, para cruzar con los archivos del bucket. */
export async function findImagesByUrls(
  urls: string[],
): Promise<Map<string, PortfolioImage>> {
  if (urls.length === 0) return new Map();
  const col = await getCollection();
  const docs = await col.find({ url: { $in: urls } }).toArray();
  return new Map(docs.map((d) => [d.url, d]));
}

export async function findImageByUrl(
  url: string,
): Promise<PortfolioImage | null> {
  const col = await getCollection();
  return col.findOne({ url });
}

/**
 * Crea o actualiza el doc de una imagen (clave: `url` único). Valida los
 * campos contra el contrato (lanza ZodError si no cumplen) y aplica los
 * invariantes que ninguna ruta puede saltarse:
 *   - `category` derivado: si vienen `categories`, category = categories[0]
 *     (o se elimina si la lista queda vacía).
 *   - Insert con visible=false salvo valor explícito: nada se publica en el
 *     sitio antes de revisarlo.
 */
export async function upsertImage(
  url: string,
  file: string,
  rawFields: PortfolioImageFields,
): Promise<PortfolioImage> {
  const fields = portfolioImageFieldsSchema.parse(rawFields);
  const col = await getCollection();
  const now = new Date();

  // No copiar claves con undefined: el driver las serializaría como null.
  const set: Record<string, unknown> = { file, updatedAt: now };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) set[key] = value;
  }

  const unset: Record<string, ""> = {};
  if (fields.categories !== undefined) {
    if (fields.categories.length > 0) {
      set.category = fields.categories[0];
    } else {
      unset.category = "";
    }
  }

  // Los defaults solo en $setOnInsert: un update no debe pisar lo que ya hay
  // salvo que venga explícito en `fields`.
  const defaults: Record<string, unknown> = { createdAt: now };
  if (fields.stars === undefined) defaults.stars = 0;
  if (fields.portfolio === undefined) defaults.portfolio = false;
  if (fields.visible === undefined) defaults.visible = false;
  if (fields.categories === undefined) defaults.categories = [];

  const update: Record<string, unknown> = { $set: set, $setOnInsert: defaults };
  if (Object.keys(unset).length > 0) update.$unset = unset;

  const result = await col.findOneAndUpdate({ url }, update, {
    upsert: true,
    returnDocument: "after",
  });
  if (!result) throw new Error("El upsert no devolvió el documento");
  return result;
}

/**
 * Actualización parcial de un doc existente (para la cola de revisión: tocar
 * stars/visible/portfolio sin reenviar el resto). A diferencia de upsertImage
 * NO hace upsert: si la URL no tiene doc devuelve null — un PATCH nunca debe
 * crear stubs. Mantiene el invariante de `category` derivado.
 */
export async function updateImageFields(
  url: string,
  rawFields: PortfolioImageFields,
): Promise<PortfolioImage | null> {
  const fields = portfolioImageFieldsSchema.parse(rawFields);
  const col = await getCollection();

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) set[key] = value;
  }

  const unset: Record<string, ""> = {};
  if (fields.categories !== undefined) {
    if (fields.categories.length > 0) {
      set.category = fields.categories[0];
    } else {
      unset.category = "";
    }
  }

  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;

  return col.findOneAndUpdate({ url }, update, { returnDocument: "after" });
}

/**
 * Toda la colección de una pasada, en orden estable por `url` (el prefijo de
 * la key agrupa las sesiones de forma natural). Para la cola de revisión, que
 * filtra y pagina en el cliente; con el volumen del portfolio (decenas de
 * docs) no hace falta paginar en el servidor.
 */
export async function listAllImages(): Promise<PortfolioImage[]> {
  const col = await getCollection();
  return col.find({}).sort({ url: 1 }).toArray();
}

export async function deleteImageByUrl(url: string): Promise<boolean> {
  const col = await getCollection();
  const result = await col.deleteOne({ url });
  return result.deletedCount === 1;
}

/** Sesiones de fotos (contexto para la IA), más recientes primero (llevan prefijo de fecha). */
export async function listSessions(): Promise<PortfolioSession[]> {
  const col = await getSessionsCollection();
  return col.find({}).sort({ session: -1 }).toArray();
}

export async function findSessionByName(
  name: string,
): Promise<PortfolioSession | null> {
  const col = await getSessionsCollection();
  return col.findOne({ session: name });
}

/** Crea o actualiza el contexto de una sesión (clave: el nombre). */
export async function upsertSession(
  rawSession: string,
  rawContext: string,
): Promise<PortfolioSession> {
  const { session, context } = portfolioSessionInputSchema.parse({
    session: rawSession,
    context: rawContext,
  });
  const col = await getSessionsCollection();
  const now = new Date();
  const result = await col.findOneAndUpdate(
    { session },
    { $set: { context, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) throw new Error("El upsert no devolvió el documento");
  return result;
}

/** Tags del vocabulario controlado (colección `tags`; jerarquía llega en Fase 4). */
export async function listTags(): Promise<Tag[]> {
  const col = await getTagsCollection();
  return col.find({}).sort({ name: 1 }).toArray();
}

/**
 * Añade un tag al vocabulario si no existe (clave: nombre en minúsculas).
 * Si ya existe no toca nada — el rename/merge/jerarquía es cosa de la Fase 4.
 */
export async function upsertTag(
  rawName: string,
  rawParent: string | null = null,
): Promise<Tag> {
  const { name, parent } = tagSchema.parse({ name: rawName, parent: rawParent });
  const col = await getTagsCollection();
  const result = await col.findOneAndUpdate(
    { name },
    { $setOnInsert: { name, parent } },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) throw new Error("El upsert no devolvió el documento");
  return result;
}

/**
 * Categorías ya usadas en el portafolio (principal + etiquetas), para
 * ofrecérselas a Claude como vocabulario preferido y a la UI como sugerencias.
 */
export async function distinctCategories(): Promise<string[]> {
  const col = await getCollection();
  const [main, tags] = await Promise.all([
    col.distinct("category"),
    col.distinct("categories"),
  ]);
  const merged = new Set(
    [...main, ...tags].filter(
      (c): c is string => typeof c === "string" && c.trim().length > 0,
    ),
  );
  return [...merged].sort();
}
