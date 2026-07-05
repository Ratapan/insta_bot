// Lista una carpeta del bucket público del portafolio y cruza cada archivo
// con su doc de metadata en Mongo (si existe), para que la UI marque qué
// imágenes están catalogadas. Solo el dueño llega aquí (gate en middleware).
import type { APIRoute } from "astro";
import { findImagesByUrls } from "../../../lib/portfolioDb";
import { listPortfolioFolder } from "../../../lib/portfolioStorage";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  const prefix = context.url.searchParams.get("prefix") ?? "";

  try {
    const { prefix: clean, folders, files } = await listPortfolioFolder(prefix);
    const docs = await findImagesByUrls(files.map((f) => f.url));

    return json({
      prefix: clean,
      folders,
      files: files.map((f) => ({
        ...f,
        image: docs.get(f.url) ?? null,
      })),
    });
  } catch (err) {
    console.error("[portfolio/browse]", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
