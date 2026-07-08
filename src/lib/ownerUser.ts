// Usuario propietario fijo (la app es de un solo usuario desde que se quitó
// Better Auth). Se reutiliza la primera fila de la tabla `user` para que los
// datos existentes (cuenta de Instagram conectada, posts programados, logs y
// el namespace u/{userId}/ del bucket) sigan colgando del mismo id; si la base
// está vacía (deploy nuevo), se crea una fila sintética.
//
// Las tablas session/account/verification de Better Auth se conservan en el
// esquema para no migrar; ya no se usan.

import { asc } from "drizzle-orm";
import { db } from "./db";
import { user } from "../db/schema";

export interface OwnerUser {
  id: string;
  email: string;
  name: string;
}

let cached: OwnerUser | null = null;

export async function getOwnerUser(): Promise<OwnerUser> {
  if (cached) return cached;

  const existing = await db.query.user.findFirst({
    orderBy: [asc(user.createdAt)],
  });
  if (existing) {
    cached = { id: existing.id, email: existing.email, name: existing.name };
    return cached;
  }

  const now = new Date();
  const fresh = {
    id: crypto.randomUUID(),
    name: "Owner",
    email: "owner@insta.local",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(user).values(fresh);
  cached = { id: fresh.id, email: fresh.email, name: fresh.name };
  return cached;
}
