import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount } from "../../../db/schema";
import { MetaApiError, getRecentMedia } from "../../../lib/instagram";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  const account = await db.query.instagramAccount.findFirst({
    where: eq(instagramAccount.userId, context.locals.user!.id),
  });

  if (!account) {
    return json({ error: "not_connected" }, 409);
  }

  try {
    const media = await getRecentMedia(account.accessToken, account.igUserId, 6);
    return json({ media });
  } catch (err) {
    console.error("[instagram/media]", err);
    if (err instanceof MetaApiError && err.isAuthError) {
      return json({ error: "reconnect" }, 409);
    }
    return json({ error: "meta_error" }, 502);
  }
};
