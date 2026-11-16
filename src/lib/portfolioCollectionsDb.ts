// Colecciones curadas del portafolio (colección `collections` de la Mongo del
// portfolio). Solo insta_bot escribe; portfolio_2026 las lee en el build.
//
// El contrato vive en portfolioSchema.ts (collectionInputSchema). Como no hay
// Mongoose, van a mano: `updatedAt` en cada escritura, `createdAt` al insertar,
// slug único (autogenerado desde el título si falta) y la portada por defecto.
import type { Collection, UpdateFilter } from "mongodb";
import { getDb } from "./portfolioDb";
import { ensureUniqueSlug } from "./slug";
import {
  collectionInputSchema,
  type CollectionInput,
  type PortfolioCollection,
} from "./portfolioSchema";

export type { PortfolioCollection };

async function getCollectionsCollection(): Promise<Collection<PortfolioCollection>> {
  return (await getDb()).collection<PortfolioCollection>("collections");
}

export interface CollectionSummary {
  slug: string;
  title: string;
  published: boolean;
  order: number;
  count: number;
  cover?: string;
  updatedAt: Date;
}

export async function listCollections(): Promise<CollectionSummary[]> {
  const col = await getCollectionsCollection();
  const docs = await col.find({}).sort({ order: 1, updatedAt: -1 }).toArray();
  return docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    published: d.published,
    order: d.order ?? 0,
    count: d.photos?.length ?? 0,
    cover: d.cover ?? d.photos?.[0],
    updatedAt: d.updatedAt,
  }));
}

export async function findCollectionBySlug(slug: string): Promise<PortfolioCollection | null> {
  const col = await getCollectionsCollection();
  return col.findOne({ slug }, { projection: { _id: 0 } });
}

function parse(raw: unknown): CollectionInput {
  const result = collectionInputSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message;
    // Los refine traen códigos propios; el resto es "invalid_fields".
    throw new Error(
      message === "published_requires_photos" || message === "cover_not_in_photos"
        ? message
        : "invalid_fields",
    );
  }
  return result.data;
}

/**
 * Campos a guardar: la portada cae en la primera foto si no se eligió. Sin
 * claves undefined: el driver las guardaría como null (y chocarían con el
 * $unset del update).
 */
function fields(input: CollectionInput): Omit<PortfolioCollection, "slug" | "createdAt" | "updatedAt"> {
  const { slug: _slug, ...rest } = input;
  const out = { ...rest, cover: input.cover ?? input.photos[0] };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as typeof out;
}

export async function createCollection(raw: unknown): Promise<PortfolioCollection> {
  const input = parse(raw);
  const col = await getCollectionsCollection();
  const taken = async (s: string) => (await col.countDocuments({ slug: s }, { limit: 1 })) > 0;
  let slug: string;
  if (input.slug) {
    if (await taken(input.slug)) throw new Error("slug_taken");
    slug = input.slug;
  } else {
    slug = await ensureUniqueSlug(input.title, taken);
  }
  const now = new Date();
  const doc: PortfolioCollection = { ...fields(input), slug, createdAt: now, updatedAt: now };
  await col.insertOne({ ...doc });
  return doc;
}

export async function updateCollectionBySlug(
  slug: string,
  raw: unknown,
): Promise<PortfolioCollection> {
  const input = parse(raw);
  const col = await getCollectionsCollection();
  const current = await col.findOne({ slug });
  if (!current) throw new Error("not_found");

  const nextSlug = input.slug ?? slug;
  if (nextSlug !== slug && (await col.countDocuments({ slug: nextSlug }, { limit: 1 })) > 0) {
    throw new Error("slug_taken");
  }
  // Campos opcionales que se vaciaron: se quitan del doc ($unset vacío es un
  // error en Mongo, así que solo va si hay algo que quitar).
  const cleared = (["title_en", "intro", "intro_en"] as const).filter((k) => input[k] === undefined);
  const update: UpdateFilter<PortfolioCollection> = {
    $set: { ...fields(input), slug: nextSlug, updatedAt: new Date() },
  };
  if (cleared.length) update.$unset = Object.fromEntries(cleared.map((k) => [k, ""]));
  const updated = await col.findOneAndUpdate({ slug }, update, {
    returnDocument: "after",
    projection: { _id: 0 },
  });
  if (!updated) throw new Error("not_found");
  return updated;
}

export async function deleteCollectionBySlug(slug: string): Promise<boolean> {
  const col = await getCollectionsCollection();
  const result = await col.deleteOne({ slug });
  return result.deletedCount === 1;
}
