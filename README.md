# Cómo obtener las credenciales de InstaCaptions

Guía actualizada (junio 2026) para rellenar el `.env`.

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

## Resumen

| Variable | Origen |
| --- | --- |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys |
| `META_APP_ID` | **Instagram** App ID (Casos de uso → Personalizar → Configuración de la API; **no** el de Información básica) |
| `META_APP_SECRET` | **Instagram** App Secret (mismo sitio que el anterior) |
| `META_REDIRECT_URI` | Debe ser **HTTPS** y coincidir exactamente con el registrado en Meta (Paso 4 → Configurar inicio de sesión empresarial) |
| `R2_ACCOUNT_ID` | R2 → Overview → Account Details |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 → Manage API Tokens → Create API Token |
| `R2_BUCKET` | Nombre que diste al bucket |