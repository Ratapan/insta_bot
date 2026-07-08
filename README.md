# InstaCaptions (insta_bot)

App web de un solo usuario que genera captions de Instagram con Claude y los publica directamente en una cuenta Business/Creator. Además funciona como **centro de administración de contenido del portfolio** [javiersabando.lat](https://javiersabando.lat) (repo `portfolio_2025`): subida de imágenes, conversión a WebP, extracción de EXIF y generación de metadatos bilingües con IA.

**Stack:** Astro 5 (SSR) · Vue 3 (islands) · Tailwind CSS 4 · Drizzle ORM + SQLite · Cloudflare R2 · Anthropic SDK.

## Funcionalidades

- **Captions para posts existentes** — lee los posts recientes de Instagram, genera captions con Claude y los copia al portapapeles (la API de Instagram no permite editar captions ya publicados).
- **Publicar nuevos posts** — sube o elige una imagen de la biblioteca, genera el caption y publica directo vía la API de Instagram. Soporta programación de posts.
- **Biblioteca de medios** — explorador de archivos sobre un bucket R2 privado (subir, carpetas, borrar).
- **Gestor del portfolio** (`/app/portfolio`) — administra las imágenes del sitio portfolio: pipeline subida → EXIF → WebP → metadatos bilingües generados por Claude → guardado en el Mongo del portfolio (ocultas por defecto hasta revisarlas).

La autenticación es de usuario único: una sola contraseña (`APP_PASSWORD`), sin registro ni cuentas.

## Puesta en marcha

Requisitos: Node 20+, **pnpm 10.17**.

```bash
pnpm install
cp .env.example .env   # rellenar según la guía de credenciales de abajo
pnpm dev               # https://localhost:4321 (HTTPS autofirmado)
```

Las migraciones de SQLite se aplican solas al arrancar (no hay paso de migrate aparte).

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo en https://localhost:4321 |
| `pnpm build` | Build de producción a `dist/` |
| `pnpm start` | Ejecuta el build (`node ./dist/server/entry.mjs`) |
| `pnpm db:generate` | Genera una migración tras editar `src/db/schema.ts` |
| `pnpm db:studio` | Drizzle Studio para inspeccionar la BD |
| `pnpm astro check` | Type-check |

> **Nota pnpm:** los deps nativos (`better-sqlite3`, `sharp`, `esbuild`, `exifreader`, `@tailwindcss/oxide`) deben estar en `onlyBuiltDependencies` de `pnpm-workspace.yaml` o pnpm se salta sus build scripts y la app falla al arrancar (`Could not locate the bindings file`). Tras añadir uno nuevo: `pnpm rebuild <pkg>`.

## Estructura

- `src/pages/app/*.astro` — páginas de la app (shells finos que montan islas Vue).
- `src/pages/api/*` — API JSON: `instagram/`, `captions/`, `storage/` (biblioteca R2 propia) y `portfolio/` (gestor del portfolio).
- `src/lib/` — wrappers de servicios externos: `instagram.ts`, `claude.ts`, `storage.ts` (R2 privado) y los módulos del portfolio (`portfolioDb.ts`, `portfolioStorage.ts`, `portfolioImage.ts`).
- `src/middleware.ts` — guarda `/app/*` y `/api/*` con la sesión de usuario único.

## Despliegue

`pnpm build` + `pnpm start`. La BD SQLite vive en `DATABASE_PATH` (por defecto `./data/app.db`): en producción (Railway) necesita un volumen persistente. Definir todas las variables del `.env` en el entorno, incluida `APP_PASSWORD`. Las migraciones se aplican automáticamente en cada arranque.

---

# Cómo obtener las credenciales

Guía actualizada (junio 2026) para rellenar el `.env`.

## `APP_PASSWORD`

Contraseña de acceso a la app (única cuenta; sin registro). Elige una fuerte; cambiarla invalida la sesión activa.

## `SESSION_SECRET`

```bash
openssl rand -hex 32
```

## `ANTHROPIC_API_KEY`

1. [console.anthropic.com](https://console.anthropic.com) → **Settings → API Keys → Create Key**.
2. Copia la key (empieza con `sk-ant-`, **solo se muestra una vez**).
3. Configura un método de pago en la cuenta o las requests fallarán.

## Meta / Instagram

La app usa el flujo **Instagram API con Instagram Login** (el nuevo). El token va directo a la cuenta de Instagram Business: **no** hace falta vincular Instagram a una página de Facebook ni pasar verificación de negocio.

> **Guía detallada paso a paso, HTTPS en local y troubleshooting:** [`docs/meta-instagram-setup.md`](docs/meta-instagram-setup.md). Léela: el setup de Meta tiene varios puntos que dan errores poco obvios.

Resumen de lo imprescindible:

1. **Cuenta de Instagram Profesional** (Business o Creator). No necesita página de Facebook.
2. **Crea la app** en [developers.facebook.com/apps](https://developers.facebook.com/apps) con el caso de uso **"Administrar mensajes y contenido en Instagram"** (*Manage messaging & content on Instagram*).
3. **Credenciales correctas**: el `META_APP_ID`/`META_APP_SECRET` son el **Instagram App ID/Secret** de *Casos de uso → Personalizar → Configuración de la API*, **no** los de *Información básica* (esos son los de Facebook y dan `Invalid platform app`).
4. **Permisos**: *Add all required permissions* + añade manualmente `instagram_business_content_publish`.
5. **Tester**: añade tu `@usuario` en *Roles → Instagram testers* y **acepta la invitación desde la app de Instagram**, o el OAuth da `Insufficient Developer Role`.
6. **Redirect URI**: `{PUBLIC_BASE_URL}/api/instagram/callback`, **obligatoriamente HTTPS** (Instagram Login no acepta `http://localhost`). Ver la sección de HTTPS local en el doc.

Scopes que pide la app: `instagram_business_basic,instagram_business_content_publish` (en `OAUTH_SCOPES`, `src/lib/instagram.ts`).

## Cloudflare R2

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**.
2. **Create bucket** con el nombre que uses en `R2_BUCKET` (p. ej. `insta-bot-media`). Déjalo privado.
3. En **R2 → Overview → Account Details**:
   - Copia el **Account ID** → `R2_ACCOUNT_ID`.
   - Pulsa **Manage** junto a *API Tokens* → **Create API Token**.
4. Permisos: **Object Read & Write**, restringido a tu bucket. Crea el token.
5. Cloudflare muestra el **Access Key ID** y **Secret Access Key** **una sola vez**. Cópialos a `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`.

## Gestor del portfolio (`PORTFOLIO_*`)

Estas variables conectan con la infraestructura de `portfolio_2025` (son sus credenciales, no unas nuevas):

- `PORTFOLIO_MONGODB_URI` — la **misma URI** que el `MONGODB_URI` del portfolio (base de datos `rtp_blog` en la URI).
- `PORTFOLIO_R2_ACCOUNT_ID` / `PORTFOLIO_R2_ACCESS_KEY_ID` / `PORTFOLIO_R2_SECRET_ACCESS_KEY` / `PORTFOLIO_R2_BUCKET` — el bucket R2 **público** del portfolio (distinto de `insta-bot-media`, que es privado). Crea el token igual que en la sección anterior, restringido a ese bucket.
- `PORTFOLIO_ASSETS_BASE_URL` — URL pública del bucket: `https://assets.javiersabando.lat`.

## Resumen

| Variable | Origen |
| --- | --- |
| `APP_PASSWORD` | Contraseña que elijas (usuario único) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys |
| `META_APP_ID` | **Instagram** App ID (Casos de uso → Personalizar → Configuración de la API; **no** el de Información básica) |
| `META_APP_SECRET` | **Instagram** App Secret (mismo sitio que el anterior) |
| `META_REDIRECT_URI` | Debe ser **HTTPS** y coincidir exactamente con el registrado en Meta (Paso 4 → Configurar inicio de sesión empresarial) |
| `R2_ACCOUNT_ID` | R2 → Overview → Account Details |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 → Manage API Tokens → Create API Token |
| `R2_BUCKET` | Nombre que diste al bucket |
| `PORTFOLIO_MONGODB_URI` | El `MONGODB_URI` de portfolio_2025 |
| `PORTFOLIO_R2_*` | Credenciales del bucket público del portfolio |
| `PORTFOLIO_ASSETS_BASE_URL` | `https://assets.javiersabando.lat` |
