import { defineMiddleware } from "astro:middleware";
import { auth } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Better Auth gestiona sus propias rutas; no hace falta resolver la sesión.
  if (pathname.startsWith("/api/auth")) {
    return next();
  }

  const sessionData = await auth.api.getSession({
    headers: context.request.headers,
  });

  context.locals.user = sessionData?.user ?? null;
  context.locals.session = sessionData?.session ?? null;

  if (pathname.startsWith("/app") || pathname.startsWith("/api")) {
    if (!sessionData) {
      return pathname.startsWith("/api")
        ? new Response(JSON.stringify({ error: "No autenticado" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : context.redirect("/login");
    }
  }

  if ((pathname === "/login" || pathname === "/register") && sessionData) {
    return context.redirect("/app");
  }

  return next();
});
