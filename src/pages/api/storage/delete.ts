import type { APIRoute } from "astro";
import { deleteFile, deleteFolder } from "../../../lib/storage";

export const POST: APIRoute = async (context) => {
  let body: { type?: "file" | "folder"; target?: string };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  if (!body.target || (body.type !== "file" && body.type !== "folder")) {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  try {
    if (body.type === "file") {
      await deleteFile(context.locals.user!.id, body.target);
    } else {
      await deleteFolder(context.locals.user!.id, body.target);
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[storage/delete]", err);
    return new Response(JSON.stringify({ error: "storage_error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
