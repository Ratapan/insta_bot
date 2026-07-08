import { defineMiddleware } from "astro:middleware";
import { getOwnerUser } from "./lib/ownerUser";
import { COOKIE_NAME, isValidSession } from "./lib/session";
// Arranca el scheduler de publicaciones programadas (efecto de módulo, 1 vez).
import "./lib/scheduler";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Rutas de API abiertas (sin guard de sesión):
  //  - /api/login: el propio login por password.
  //  - /api/instagram/callback: retorno del OAuth de Instagram. Llega como
  //    navegación cross-site (Meta rebota vía l.instagram.com), así que no
  //    puede depender de que la cookie de sesión sobreviva ese salto. Su CSRF
  //    lo protege la cookie ig_oauth_state (comparada con el `state`); el
  //    handler resuelve el usuario dueño por su cuenta.
  if (pathname === "/api/login" || pathname === "/api/instagram/callback") {
    return next();
  }

  // App de un solo usuario: la sesión es una cookie firmada derivada de
  // APP_PASSWORD y locals.user es siempre el usuario propietario.
  const authed = isValidSession(context.cookies.get(COOKIE_NAME)?.value);
  context.locals.user = authed ? await getOwnerUser() : null;

  if (pathname.startsWith("/app") || pathname.startsWith("/api")) {
    if (!authed) {
      return pathname.startsWith("/api")
        ? new Response(JSON.stringify({ error: "No autenticado" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : context.redirect("/login");
    }
  }

  if (pathname === "/login" && authed) {
    return context.redirect("/app");
  }

  return next();
});
