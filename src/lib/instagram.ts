// Instagram API con Instagram Login (no Facebook Login).
// El token va directo a la cuenta de Instagram Business; ya no se pasa por
// páginas de Facebook ni por verificación de negocio.
//   - OAuth:   https://www.instagram.com/oauth/authorize
//   - Tokens:  https://api.instagram.com/oauth/access_token  (código → token corto)
//              https://graph.instagram.com/access_token       (corto → largo)
//              https://graph.instagram.com/refresh_access_token (refrescar largo)
//   - Graph:   https://graph.instagram.com/v23.0/...

const GRAPH_BASE = "https://graph.instagram.com/v23.0";

const OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
].join(",");

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public type?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Código 190: token inválido o expirado — el usuario debe reconectar. */
  get isAuthError(): boolean {
    return this.code === 190;
  }
}

/**
 * Parsea una respuesta de la API de Instagram tolerando cuerpos no-JSON
 * (páginas HTML de error, respuestas vacías…). Prioriza el error estructurado
 * del body si existe; si no, cae al código HTTP.
 */
async function parseGraphResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: (T & { error?: { message: string; code: number; type: string } }) | null =
    null;
  try {
    data = JSON.parse(text);
  } catch {
    // Respuesta no-JSON: se maneja abajo con el status HTTP.
  }
  if (data?.error) {
    throw new MetaApiError(data.error.message, data.error.code, data.error.type);
  }
  if (!res.ok || data == null) {
    throw new MetaApiError(
      `Respuesta inesperada de Instagram (HTTP ${res.status})`,
    );
  }
  return data;
}

async function graphFetch<T>(
  path: string,
  params: Record<string, string> = {},
  init?: RequestInit,
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, init);
  return parseGraphResponse<T>(res);
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function getAuthorizationUrl(state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", import.meta.env.META_APP_ID);
  url.searchParams.set("redirect_uri", import.meta.env.META_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/**
 * Intercambia el `code` del callback por un token corto. La respuesta incluye
 * el `user_id`, que es el ID de la cuenta de Instagram Business y reemplaza al
 * antiguo paso de descubrir la página de Facebook vinculada.
 */
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  igUserId: string;
}> {
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: import.meta.env.META_APP_ID,
      client_secret: import.meta.env.META_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: import.meta.env.META_REDIRECT_URI,
      code,
    }),
  });
  // Este endpoint usa un formato de error propio (error_type/error_message en
  // la raíz), así que no pasa por parseGraphResponse; pero igual toleramos
  // cuerpos no-JSON para no acabar en un parse error opaco.
  let data: {
    access_token?: string;
    user_id?: number | string;
    error_type?: string;
    code?: number;
    error_message?: string;
  } = {};
  try {
    data = await res.json();
  } catch {
    // Respuesta no-JSON: cae al error genérico de abajo con el status HTTP.
  }
  if (!data.access_token || data.user_id == null) {
    throw new MetaApiError(
      data.error_message ??
        `No se pudo obtener el token de Instagram (HTTP ${res.status})`,
      data.code,
      data.error_type,
    );
  }
  return {
    accessToken: data.access_token,
    igUserId: String(data.user_id),
  };
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const data = await graphFetchAbsolute<{
    access_token: string;
    expires_in?: number;
  }>("https://graph.instagram.com/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: import.meta.env.META_APP_SECRET,
    access_token: shortLivedToken,
  });
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
  };
}

/**
 * Refresca un token largo aún vivo (≥24h de antigüedad, no caducado) por otro
 * de 60 días. Conviene llamarlo cuando al token le quedan menos de 7 días para
 * no tener que reconectar.
 */
export async function refreshLongLivedToken(
  longLivedToken: string,
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const data = await graphFetchAbsolute<{
    access_token: string;
    expires_in?: number;
  }>("https://graph.instagram.com/refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: longLivedToken,
  });
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
  };
}

/** Igual que graphFetch pero contra una URL absoluta (endpoints sin /v23.0). */
async function graphFetchAbsolute<T>(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  return parseGraphResponse<T>(res);
}

/** Perfil de la cuenta conectada (para mostrar el @usuario en Ajustes). */
export async function getMe(
  accessToken: string,
): Promise<{ igUserId: string; igUsername: string | null }> {
  const data = await graphFetch<{ user_id?: string; id?: string; username?: string }>(
    "/me",
    {
      fields: "user_id,username",
      access_token: accessToken,
    },
  );
  return {
    igUserId: String(data.user_id ?? data.id),
    igUsername: data.username ?? null,
  };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

interface IgMediaChildren {
  id: string;
  media_type: "IMAGE" | "VIDEO";
  media_url: string;
  thumbnail_url?: string;
}
export interface IgMedia {
  id: string;
  caption: string | null;
  media_url: string;
  thumbnail_url?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  timestamp: string;
  permalink: string;
  like_count: number;
  comments_count: number;
  children?: IgMediaChildren[];
}

export async function getRecentMedia(
  accessToken: string,
  igUserId: string,
  limit = 6,
): Promise<IgMedia[]> {
  const data = await graphFetch<{ data: IgMedia[] }>(`/${igUserId}/media`, {
    fields: "id,caption,media_url,thumbnail_url,media_type,timestamp,permalink,like_count,comments_count,children{id,media_type,media_url,thumbnail_url}",
    limit: String(limit),
    access_token: accessToken,
  });
  return data.data ?? [];
}

// ---------------------------------------------------------------------------
// Publicación (Flujo B): container + publish
// ---------------------------------------------------------------------------

export async function createMediaContainer(
  accessToken: string,
  igUserId: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const data = await graphFetch<{ id: string }>(
    `/${igUserId}/media`,
    {},
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    },
  );
  return data.id;
}

/**
 * Crea el container de una imagen suelta de un carrusel (`is_carousel_item`).
 * No lleva caption; el caption va en el container del carrusel.
 */
export async function createCarouselItemContainer(
  accessToken: string,
  igUserId: string,
  imageUrl: string,
): Promise<string> {
  const data = await graphFetch<{ id: string }>(
    `/${igUserId}/media`,
    {},
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: "true",
        access_token: accessToken,
      }),
    },
  );
  return data.id;
}

/**
 * Crea el container del carrusel a partir de los ids de los items (2-10) y el
 * caption. Hay que esperar a que esté `FINISHED` antes de publicarlo.
 */
export async function createCarouselContainer(
  accessToken: string,
  igUserId: string,
  childIds: string[],
  caption: string,
): Promise<string> {
  const data = await graphFetch<{ id: string }>(
    `/${igUserId}/media`,
    {},
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption,
        access_token: accessToken,
      }),
    },
  );
  return data.id;
}

export async function getContainerStatus(
  accessToken: string,
  creationId: string,
): Promise<string> {
  const data = await graphFetch<{ status_code: string }>(`/${creationId}`, {
    fields: "status_code",
    access_token: accessToken,
  });
  return data.status_code;
}

export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string,
): Promise<string> {
  const data = await graphFetch<{ id: string }>(
    `/${igUserId}/media_publish`,
    {},
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    },
  );
  return data.id;
}

export async function getMediaById(
  accessToken: string,
  mediaId: string,
): Promise<Pick<IgMedia, "id" | "media_url" | "thumbnail_url" | "media_type" | "permalink">> {
  return graphFetch(`/${mediaId}`, {
    fields: "id,media_url,thumbnail_url,media_type,permalink",
    access_token: accessToken,
  });
}

export async function getMediaPermalink(
  accessToken: string,
  mediaId: string,
): Promise<string | null> {
  const data = await graphFetch<{ permalink?: string }>(`/${mediaId}`, {
    fields: "permalink",
    access_token: accessToken,
  });
  return data.permalink ?? null;
}
