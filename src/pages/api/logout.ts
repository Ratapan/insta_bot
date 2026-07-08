import type { APIRoute } from "astro";
import { COOKIE_NAME } from "../../lib/session";

export const POST: APIRoute = async (context) => {
  context.cookies.delete(COOKIE_NAME, { path: "/" });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
