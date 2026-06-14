import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { generationLog } from "../../../db/schema";

export const POST: APIRoute = async (context) => {
  let body: { logId?: string; chosenIndex?: number };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  if (!body.logId || typeof body.chosenIndex !== "number") {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  await db
    .update(generationLog)
    .set({ chosenIndex: body.chosenIndex })
    .where(
      and(
        eq(generationLog.id, body.logId),
        eq(generationLog.userId, context.locals.user!.id),
      ),
    );

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
