import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = import.meta.env.R2_BUCKET;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${import.meta.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: import.meta.env.R2_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.R2_SECRET_ACCESS_KEY,
  },
});

export interface StorageFolder {
  name: string;
  path: string;
}

export interface StorageFile {
  /** Ruta relativa al espacio del usuario, p. ej. "viajes/playa.jpg". */
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  /** URL firmada temporal para previsualizar. */
  url: string;
}

function userPrefix(userId: string): string {
  return `u/${userId}/`;
}

/**
 * Normaliza una ruta relativa enviada por el cliente y rechaza cualquier
 * intento de escapar del espacio del usuario.
 */
export function sanitizeRelPath(path: string): string {
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((s) => s.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error("Ruta no válida");
    }
  }
  return segments.join("/");
}

export async function listFolder(
  userId: string,
  path: string,
): Promise<{ folders: StorageFolder[]; files: StorageFile[] }> {
  const rel = sanitizeRelPath(path);
  const prefix = userPrefix(userId) + (rel ? `${rel}/` : "");

  const result = await r2.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: 500,
    }),
  );

  const folders: StorageFolder[] = (result.CommonPrefixes ?? []).map((cp) => {
    const full = cp.Prefix!;
    const relPath = full.slice(userPrefix(userId).length).replace(/\/$/, "");
    return { name: relPath.split("/").pop()!, path: relPath };
  });

  const files: StorageFile[] = [];
  for (const obj of result.Contents ?? []) {
    if (!obj.Key || obj.Key === prefix) continue; // marcador de carpeta
    const relKey = obj.Key.slice(userPrefix(userId).length);
    files.push({
      key: relKey,
      name: relKey.split("/").pop()!,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified?.toISOString() ?? null,
      url: await getPresignedUrl(userId, relKey),
    });
  }

  return { folders, files };
}

export async function createFolder(userId: string, path: string): Promise<void> {
  const rel = sanitizeRelPath(path);
  if (!rel) throw new Error("Ruta no válida");
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${userPrefix(userId)}${rel}/`,
      Body: "",
    }),
  );
}

export async function uploadFile(
  userId: string,
  path: string,
  filename: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const dir = sanitizeRelPath(path);
  const name = sanitizeRelPath(filename);
  if (!name) throw new Error("Nombre de archivo no válido");
  const relKey = dir ? `${dir}/${name}` : name;

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${userPrefix(userId)}${relKey}`,
      Body: body,
      ContentType: contentType,
    }),
  );
  return relKey;
}

export async function deleteFile(userId: string, key: string): Promise<void> {
  const rel = sanitizeRelPath(key);
  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: `${userPrefix(userId)}${rel}`,
    }),
  );
}

export async function deleteFolder(userId: string, path: string): Promise<void> {
  const rel = sanitizeRelPath(path);
  if (!rel) throw new Error("No se puede borrar la carpeta raíz");
  const prefix = `${userPrefix(userId)}${rel}/`;

  let continuationToken: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k);
    if (keys.length > 0) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

/** URL firmada temporal; Instagram la usa para descargar la imagen al publicar. */
export async function getPresignedUrl(
  userId: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const rel = sanitizeRelPath(key);
  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: `${userPrefix(userId)}${rel}`,
    }),
    { expiresIn },
  );
}

export async function getObjectAsBase64(
  userId: string,
  key: string,
): Promise<{ base64: string; contentType: string; size: number }> {
  const rel = sanitizeRelPath(key);
  const result = await r2.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: `${userPrefix(userId)}${rel}`,
    }),
  );
  const bytes = await result.Body!.transformToByteArray();
  return {
    base64: Buffer.from(bytes).toString("base64"),
    contentType: result.ContentType ?? "image/jpeg",
    size: bytes.byteLength,
  };
}
