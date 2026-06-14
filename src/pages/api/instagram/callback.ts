import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { instagramAccount } from "../../../db/schema";
import {
  MetaApiError,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
} from "../../../lib/instagram";

export const GET: APIRoute = async (context) => {
  const userId = context.locals.user!.id;
  const params = context.url.searchParams;

  if (params.get("error")) {
    // El usuario canceló el diálogo de Meta.
    return context.redirect("/app/settings?error=denied");
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = context.cookies.get("ig_oauth_state")?.value;
  context.cookies.delete("ig_oauth_state", { path: "/" });

  if (!code || !state || !expectedState || state !== expectedState) {
    return context.redirect("/app/settings?error=state");
  }

  try {
    const { accessToken: shortToken } = await exchangeCodeForToken(code);
    const { accessToken, expiresAt } =
      await exchangeForLongLivedToken(shortToken);
    // El `user_id` del intercambio de token es app-scoped y NO sirve para las
    // llamadas Graph. El ID real de la cuenta profesional (y el @usuario) los da
    // /me?fields=user_id,username — ese es el que se usa como {ig-user-id}.
    const { igUserId, igUsername } = await getMe(accessToken);

    const now = new Date();
    const existing = await db.query.instagramAccount.findFirst({
      where: eq(instagramAccount.userId, userId),
    });

    if (existing) {
      await db
        .update(instagramAccount)
        .set({
          igUserId,
          igUsername,
          accessToken,
          tokenExpiresAt: expiresAt,
          tokenRefreshedAt: now,
          updatedAt: now,
        })
        .where(eq(instagramAccount.userId, userId));
    } else {
      await db.insert(instagramAccount).values({
        id: crypto.randomUUID(),
        userId,
        igUserId,
        igUsername,
        accessToken,
        tokenExpiresAt: expiresAt,
        tokenRefreshedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    return context.redirect("/app/settings?connected=1");
  } catch (err) {
    console.error("[instagram/callback]", err);
    const reason = err instanceof MetaApiError ? "meta" : "unknown";
    return context.redirect(`/app/settings?error=${reason}`);
  }
};
