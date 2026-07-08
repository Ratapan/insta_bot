// Sesión de usuario único por password (APP_PASSWORD) + cookie firmada.
// Mismo patrón que el admin de portfolio_2025: el token es
// sha256(password + secret), estático — cambiar la password invalida la
// sesión. Comparaciones en tiempo constante para no filtrar información.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "app_session";

function config(): { password: string; secret: string } | null {
  const password = import.meta.env.APP_PASSWORD;
  const secret = import.meta.env.SESSION_SECRET;
  if (!password || !secret) return null;
  return { password, secret };
}

export function isConfigured(): boolean {
  return config() !== null;
}

export function computeToken(): string | null {
  const c = config();
  if (!c) return null;
  return createHash("sha256").update(c.password + c.secret).digest("hex");
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const expected = computeToken();
  if (!expected || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Compara la password vía HMAC (salida de longitud fija: no filtra longitud). */
export function verifyPassword(input: string): boolean {
  const c = config();
  if (!c) return false;
  const hmacInput = createHmac("sha256", c.secret).update(input).digest();
  const hmacExpected = createHmac("sha256", c.secret).update(c.password).digest();
  return timingSafeEqual(hmacInput, hmacExpected);
}
