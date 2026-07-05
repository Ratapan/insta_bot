// Lista los docs de imágenes del portafolio desde Mongo. A diferencia del
// endpoint público del portfolio (que filtra portfolio=true y visible=true por
// defecto), aquí el gestor quiere ver todo salvo que filtre explícitamente.
import type { APIRoute } from "astro";
import { listImages } from "../../../lib/portfolioDb";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null || value === "") return undefined;
  if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no"].includes(value.toLowerCase())) return false;
  return undefined;
}

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;

  try {
    const result = await listImages({
      portfolio: parseBoolean(params.get("portfolio")),
      visible: parseBoolean(params.get("visible")),
      category: params.get("category")?.trim() || undefined,
      search: params.get("search")?.trim() || undefined,
      page: Number(params.get("page")) || undefined,
      limit: Number(params.get("limit")) || undefined,
    });
    return json(result);
  } catch (err) {
    console.error("[portfolio/images]", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
