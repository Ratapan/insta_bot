// CRUD del doc de metadata de una imagen del portafolio (colección `images`
// de Mongo, clave `url` único).
//   GET    ?url=…  → doc o 404
//   PUT    { url, file?, …campos }  → upsert. Los invariantes (visible:false
//          en el primer guardado, category derivado de categories[0]) los
//          aplica upsertImage en la lib; aquí solo se valida y orquesta.
//   PATCH  { url, …campos }  → update parcial de un doc EXISTENTE (404 si no
//          hay doc; nunca crea stubs). Lo usa la cola de revisión.
//   DELETE { url, deleteObject? }   → borra el doc y, opcionalmente, el objeto
import type { APIRoute } from "astro";
import {
  deleteImageByUrl,
  findImageByUrl,
  updateImageFields,
  upsertImage,
} from "../../../lib/portfolioDb";
import { portfolioImageFieldsSchema } from "../../../lib/portfolioSchema";
import {
  deletePortfolioObject,
  keyFromPublicUrl,
} from "../../../lib/portfolioStorage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  const url = context.url.searchParams.get("url");
  if (!url) return json({ error: "bad_request" }, 400);

  try {
    const image = await findImageByUrl(url);
    if (!image) return json({ error: "not_found" }, 404);
    return json({ image });
  } catch (err) {
    console.error("[portfolio/image] GET", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const PUT: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return json({ error: "bad_request" }, 400);

  // El schema descarta claves desconocidas (url/file van aparte; `category`
  // se ignora a propósito: es derivado).
  const parsed = portfolioImageFieldsSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);

  // `file` = nombre del archivo; si no viene, se deriva de la URL.
  const file =
    typeof body.file === "string" && body.file.trim()
      ? body.file.trim()
      : (url.split("/").at(-1) ?? url);

  try {
    const image = await upsertImage(url, file, parsed.data);
    return json({ image });
  } catch (err) {
    console.error("[portfolio/image] PUT", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const PATCH: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return json({ error: "bad_request" }, 400);

  const parsed = portfolioImageFieldsSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_fields" }, 400);

  try {
    const image = await updateImageFields(url, parsed.data);
    if (!image) return json({ error: "not_found" }, 404);
    return json({ image });
  } catch (err) {
    console.error("[portfolio/image] PATCH", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};

export const DELETE: APIRoute = async (context) => {
  let body: { url?: string; deleteObject?: boolean };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body.url) return json({ error: "bad_request" }, 400);

  try {
    const deletedDoc = await deleteImageByUrl(body.url);

    let deletedObject = false;
    if (body.deleteObject) {
      const key = keyFromPublicUrl(body.url);
      if (key) {
        await deletePortfolioObject(key);
        deletedObject = true;
      }
    }

    return json({ deletedDoc, deletedObject });
  } catch (err) {
    console.error("[portfolio/image] DELETE", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
