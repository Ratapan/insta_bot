// Cola de revisión del portafolio: devuelve TODA la colección `images` de una
// pasada (orden estable por url). El cliente agrupa por sesión, filtra y
// navega; con el volumen del portfolio no compensa paginar aquí. Solo lee de
// Mongo — funciona aunque las credenciales PORTFOLIO_R2_* no estén.
import type { APIRoute } from "astro";
import { listAllImages } from "../../../lib/portfolioDb";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async () => {
  try {
    const images = await listAllImages();
    return json({ images });
  } catch (err) {
    console.error("[portfolio/review]", err);
    return json({ error: "portfolio_unavailable" }, 502);
  }
};
