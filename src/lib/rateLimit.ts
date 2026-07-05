// Límite de peticiones en memoria, por clave (p. ej. por usuario). Pensado
// para proteger endpoints que cuestan dinero (cada generación es una request
// pagada a Claude). Igual que el scheduler, asume una sola instancia: el
// contador se reinicia con el proceso y no se comparte entre réplicas.

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/**
 * Devuelve `true` si la petición entra dentro del límite (`max` peticiones por
 * ventana de `windowMs`). Cada llamada consume un intento.
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) return false;

  entry.count++;
  return true;
}
