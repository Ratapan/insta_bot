// Categorías ya usadas en el portafolio: la UI las ofrece como sugerencias y
// el generador de metadata se las pasa a Claude como vocabulario preferido.
import type { APIRoute } from "astro";
import { distinctCategories } from "../../../lib/portfolioDb";

export const GET: APIRoute = async () => {
  try {
    const categories = await distinctCategories();
    return new Response(JSON.stringify({ categories }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[portfolio/categories]", err);
    return new Response(JSON.stringify({ error: "portfolio_unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
