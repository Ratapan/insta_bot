import type { APIRoute } from "astro";
import { getAuthorizationUrl } from "../../../lib/instagram";

export const GET: APIRoute = (context) => {
  if (!import.meta.env.META_APP_ID || !import.meta.env.META_APP_SECRET) {
    return context.redirect("/app/settings?error=config");
  }

  const state = crypto.randomUUID();
  context.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return context.redirect(getAuthorizationUrl(state));
};
