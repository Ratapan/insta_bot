// Cliente S3 para el bucket R2 PÚBLICO del portafolio (servido en
// https://assets.javiersabando.lat). Separado de storage.ts a propósito:
// aquel impone el namespace u/{userId}/ y URLs prefirmadas (bucket privado);
// este usa keys globales (p. ej. "blog/images/250927/7840.webp") y URLs
// públicas. Mezclar ambos invariantes en un módulo es pedir que una key acabe
// en el bucket equivocado.
//
// Cliente perezoso: si las env vars PORTFOLIO_R2_* no están configuradas, el
// error salta al usar el gestor, no al arrancar la app.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { sanitizeRelPath } from "./storage";

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|avif|gif|svg)$/i;

let client: S3Client | null = null;

function getClient(): { r2: S3Client; bucket: string } {
  const accountId = import.meta.env.PORTFOLIO_R2_ACCOUNT_ID;
  const accessKeyId = import.meta.env.PORTFOLIO_R2_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.PORTFOLIO_R2_SECRET_ACCESS_KEY;
  const bucket = import.meta.env.PORTFOLIO_R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Faltan las variables PORTFOLIO_R2_* en el entorno");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return { r2: client, bucket };
}

/** URL pública con la que el portfolio (y sus docs en Mongo) referencia la key. */
export function publicUrl(key: string): string {
  const base = (
    import.meta.env.PORTFOLIO_ASSETS_BASE_URL ??
    "https://assets.javiersabando.lat"
  ).replace(/\/$/, "");
  return `${base}/${key}`;
}

/** Inversa de publicUrl: la key del objeto, o null si la URL no es del bucket. */
export function keyFromPublicUrl(url: string): string | null {
  const base = (
    import.meta.env.PORTFOLIO_ASSETS_BASE_URL ??
    "https://assets.javiersabando.lat"
  ).replace(/\/$/, "");
  if (!url.startsWith(`${base}/`)) return null;
  const key = url.slice(base.length + 1);
  return key.length > 0 ? key : null;
}

export interface PortfolioObjectFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
}

/**
 * Lista un nivel de carpeta del bucket (delimiter "/"), solo imágenes.
 * Misma forma que el explorador del portfolio (server/api/admin/r2/browse).
 */
export async function listPortfolioFolder(prefix: string): Promise<{
  prefix: string;
  folders: string[];
  files: PortfolioObjectFile[];
}> {
  const { r2, bucket } = getClient();
  const clean = prefix ? `${sanitizeRelPath(prefix)}/` : "";

  const result = await r2.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: clean,
      Delimiter: "/",
      MaxKeys: 1000,
    }),
  );

  const folders = (result.CommonPrefixes ?? [])
    .map((p) => p.Prefix!)
    .filter(Boolean);

  const files = (result.Contents ?? [])
    .filter((f) => f.Key && f.Key !== clean && IMAGE_EXT.test(f.Key))
    .map((f) => ({
      key: f.Key!,
      name: f.Key!.split("/").at(-1)!,
      size: f.Size ?? 0,
      lastModified: f.LastModified?.toISOString() ?? null,
      url: publicUrl(f.Key!),
    }));

  return { prefix: clean, folders, files };
}

export async function uploadPortfolioObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { r2, bucket } = getClient();
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: sanitizeRelPath(key),
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deletePortfolioObject(key: string): Promise<void> {
  const { r2, bucket } = getClient();
  await r2.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: sanitizeRelPath(key) }),
  );
}

export async function getPortfolioObject(key: string): Promise<{
  buffer: Buffer;
  contentType: string;
  size: number;
}> {
  const { r2, bucket } = getClient();
  const result = await r2.send(
    new GetObjectCommand({ Bucket: bucket, Key: sanitizeRelPath(key) }),
  );
  const bytes = await result.Body!.transformToByteArray();
  return {
    buffer: Buffer.from(bytes),
    contentType: result.ContentType ?? "image/jpeg",
    size: bytes.byteLength,
  };
}
