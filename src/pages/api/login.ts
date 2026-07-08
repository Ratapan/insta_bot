// Login de usuario único: password contra APP_PASSWORD → cookie de sesión.
// Es la única ruta de /api/* abierta sin autenticar (ver middleware).
import type { APIRoute } from "astro";
import { checkRateLimit } from "../../lib/rateLimit";
import {
  COOKIE_NAME,
  computeToken,
  isConfigured,
  verifyPassword,
} from "../../lib/session";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!isConfigured()) {
    return json({ error: "not_configured" }, 503);
  }

  let ip = "unknown";
  try {
    ip = context.clientAddress;
  } catch {
    // clientAddress puede no estar disponible; el rate limit agrupa en "unknown".
  }
  if (!checkRateLimit(`login:${ip}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return json({ error: "rate_limited" }, 429);
  }

  let body: { password?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  if (!body.password || !verifyPassword(body.password)) {
    return json({ error: "invalid_password" }, 401);
  }

  context.cookies.set(COOKIE_NAME, computeToken()!, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    // Lax (no Strict): el callback de OAuth de Instagram vuelve como navegación
    // cross-site (redirect desde instagram.com), y con Strict el navegador no
    // mandaría la cookie de sesión → el middleware daría 401. Lax la envía en
    // navegaciones top-level pero no en POST cross-site (la protección CSRF que
    // importa; todas las mutaciones van por fetch same-origin).
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return json({ ok: true });
};
