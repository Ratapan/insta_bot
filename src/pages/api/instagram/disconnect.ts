import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount } from "../../../db/schema";

export const POST: APIRoute = async (context) => {
  await db
    .delete(instagramAccount)
    .where(eq(instagramAccount.userId, context.locals.user!.id));

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
