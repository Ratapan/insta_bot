// Cliente S3 para el bucket R2 PRIVADO de originales del portafolio: el archivo
// full-res tal como se subió (JPG/PNG/WebP), base de la futura tienda de fotos.
// Es el tercer cliente S3 y va separado a propósito de los otros dos:
//   - storage.ts          → bucket privado de insta_bot (namespace u/{userId}/).
//   - portfolioStorage.ts → bucket PÚBLICO del portfolio (URLs públicas).
//   - este                → bucket PRIVADO de originales: NUNCA arma URLs
//                           públicas; la única lectura es una URL prefirmada.
//
// Usa las mismas credenciales PORTFOLIO_R2_* (el token debe tener acceso a los
// dos buckets) + PORTFOLIO_ORIGINALS_BUCKET. Cliente perezoso: sin esa variable
// las subidas se saltan el original (el WebP público sigue funcionando).

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sanitizeRelPath } from "./storage";

/** Tipos de original aceptados → extensión con la que se guardan. */
export const ORIGINAL_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let client: S3Client | null = null;

/** ¿Están las variables para guardar originales? (Sin ellas, se salta.) */
export function originalsConfigured(): boolean {
  return Boolean(
    import.meta.env.PORTFOLIO_ORIGINALS_BUCKET &&
      import.meta.env.PORTFOLIO_R2_ACCOUNT_ID &&
      import.meta.env.PORTFOLIO_R2_ACCESS_KEY_ID &&
      import.meta.env.PORTFOLIO_R2_SECRET_ACCESS_KEY,
  );
}

function getClient(): { r2: S3Client; bucket: string } {
  const accountId = import.meta.env.PORTFOLIO_R2_ACCOUNT_ID;
  const accessKeyId = import.meta.env.PORTFOLIO_R2_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.PORTFOLIO_R2_SECRET_ACCESS_KEY;
  const bucket = import.meta.env.PORTFOLIO_ORIGINALS_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("originals_not_configured");
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

/**
 * Key del original a partir de la key del WebP público: misma ruta y nombre,
 * con la extensión del archivo original. Así un original se encuentra sin
 * consultar Mongo:
 *   blog/images/260607_tricao/DSC02983.webp + image/jpeg
 *   → blog/images/260607_tricao/DSC02983.jpg
 */
export function originalKeyFor(publicKey: string, contentType: string): string {
  const ext = ORIGINAL_TYPES[contentType];
  if (!ext) throw new Error("unsupported_type");
  const clean = sanitizeRelPath(publicKey);
  if (!clean) throw new Error("invalid_key");
  return `${clean.replace(/\.[^./]+$/, "")}.${ext}`;
}

export async function putOriginal(
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

export async function deleteOriginal(key: string): Promise<void> {
  const { r2, bucket } = getClient();
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: sanitizeRelPath(key) }));
}

/**
 * URL prefirmada de lectura (por defecto 10 min): la ÚNICA forma de leer un
 * original. Hoy la usa el gestor para revisarlo; mañana, la entrega de la tienda.
 */
export async function presignOriginal(key: string, expiresIn = 600): Promise<string> {
  const { r2, bucket } = getClient();
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: bucket, Key: sanitizeRelPath(key) }),
    { expiresIn },
  );
}
