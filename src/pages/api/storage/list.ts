import type { APIRoute } from "astro";
import { listFolder } from "../../../lib/storage";

export const GET: APIRoute = async (context) => {
  const path = context.url.searchParams.get("path") ?? "";
  try {
    const result = await listFolder(context.locals.user!.id, path);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[storage/list]", err);
    return new Response(JSON.stringify({ error: "storage_error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
