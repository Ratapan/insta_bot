import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Tablas heredadas de Better Auth (retirado: la app es de un solo usuario con
// password en APP_PASSWORD). `user` sigue viva con una única fila propietaria
// (ver src/lib/ownerUser.ts) porque el resto de tablas cuelgan de su id;
// session/account/verification ya no se usan y se conservan solo para no
// migrar.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Tablas de la aplicación
// ---------------------------------------------------------------------------

// Cuenta de Instagram Business conectada por cada usuario (Fase 2).
export const instagramAccount = sqliteTable("instagram_account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  igUserId: text("ig_user_id").notNull(),
  igUsername: text("ig_username"),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
  // Última vez que se refrescó el token largo (flujo Instagram Login).
  tokenRefreshedAt: integer("token_refreshed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Publicaciones planeadas/programadas (carrusel o imagen suelta).
// Un mismo registro sirve al planificador de feed y a la cola de programadas:
//   - status 'draft'  → hueco colocado en el grid del feed, todavía sin fecha.
//   - status 'pending'→ programado; el scheduler en proceso (src/lib/scheduler.ts)
//                        lo publica a su hora.
export const scheduledPost = sqliteTable("scheduled_post", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // Claves R2 de las imágenes (1-10), en orden. Se firman al publicar.
  storageKeys: text("storage_keys", { mode: "json" })
    .notNull()
    .$type<string[]>(),
  caption: text("caption").notNull(),
  // Nulo mientras es borrador (draft); se fija al programar.
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  // draft | pending | publishing | published | failed | canceled
  status: text("status").notNull().default("pending"),
  // Orden en el grid del planificador de feed (asc). Solo aplica a no publicados.
  position: integer("position").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  igMediaId: text("ig_media_id"),
  permalink: text("permalink"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Log de cada generación de captions para iterar el prompt (Fase 3).
export const generationLog = sqliteTable("generation_log", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // 'existing_post' (Flujo A) | 'new_post' (Flujo B)
  source: text("source").notNull(),
  igMediaId: text("ig_media_id"),
  context: text("context"),
  tone: text("tone"),
  withHashtags: integer("with_hashtags", { mode: "boolean" })
    .notNull()
    .default(true),
  options: text("options", { mode: "json" }).notNull(),
  chosenIndex: integer("chosen_index"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
