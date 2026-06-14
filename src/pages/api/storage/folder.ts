import type { APIRoute } from "astro";
import { createFolder } from "../../../lib/storage";

export const POST: APIRoute = async (context) => {
  let body: { path?: string; name?: string };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\")) {
    return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400 });
  }

  try {
    const parent = body.path ?? "";
    await createFolder(
      context.locals.user!.id,
      parent ? `${parent}/${name}` : name,
    );
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[storage/folder]", err);
    return new Response(JSON.stringify({ error: "storage_error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
