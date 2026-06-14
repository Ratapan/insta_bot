// Orquestación de la publicación en Instagram (Flujo B), reutilizada tanto por
// el endpoint inmediato (`/api/instagram/publish`) como por el scheduler de
// publicaciones programadas. Soporta una imagen suelta o un carrusel (2-10).

import {
  createCarouselContainer,
  createCarouselItemContainer,
  createMediaContainer,
  getContainerStatus,
  getMediaPermalink,
  publishMediaContainer,
} from "./instagram";
import { getPresignedUrl } from "./storage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Error de orquestación con un código de error estable para la capa HTTP/UI. */
export class PublishError extends Error {
  constructor(
    public code: "no_images" | "too_many_images" | "container_failed",
    public status?: string,
  ) {
    super(code);
    this.name = "PublishError";
  }
}

/** Espera a que un container de Instagram termine de procesarse (o falla). */
async function waitForContainer(
  accessToken: string,
  creationId: string,
): Promise<void> {
  let status = "IN_PROGRESS";
  for (let i = 0; i < 20 && status === "IN_PROGRESS"; i++) {
    await sleep(1500);
    status = await getContainerStatus(accessToken, creationId);
  }
  if (status !== "FINISHED") {
    throw new PublishError("container_failed", status);
  }
}

/**
 * Publica una o varias imágenes (de R2) en Instagram con un caption.
 * Las URLs firmadas se generan aquí en cada intento, así que lo que se guarda
 * (p. ej. en `scheduled_post`) son las claves R2, no URLs que caducan.
 */
export async function publishToInstagram(
  userId: string,
  account: { accessToken: string; igUserId: string },
  storageKeys: string[],
  caption: string,
): Promise<{ mediaId: string; permalink: string | null }> {
  if (storageKeys.length === 0) throw new PublishError("no_images");
  if (storageKeys.length > 10) throw new PublishError("too_many_images");

  const { accessToken, igUserId } = account;

  let creationId: string;
  if (storageKeys.length === 1) {
    // Imagen suelta.
    const imageUrl = await getPresignedUrl(userId, storageKeys[0], 3600);
    creationId = await createMediaContainer(
      accessToken,
      igUserId,
      imageUrl,
      caption,
    );
  } else {
    // Carrusel: un container por imagen + un container CAROUSEL con el caption.
    const childIds: string[] = [];
    for (const key of storageKeys) {
      const imageUrl = await getPresignedUrl(userId, key, 3600);
      childIds.push(
        await createCarouselItemContainer(accessToken, igUserId, imageUrl),
      );
    }
    creationId = await createCarouselContainer(
      accessToken,
      igUserId,
      childIds,
      caption,
    );
  }

  await waitForContainer(accessToken, creationId);

  const mediaId = await publishMediaContainer(accessToken, igUserId, creationId);

  let permalink: string | null = null;
  try {
    permalink = await getMediaPermalink(accessToken, mediaId);
  } catch {
    // El post ya está publicado; el permalink es solo un extra.
  }

  return { mediaId, permalink };
}
