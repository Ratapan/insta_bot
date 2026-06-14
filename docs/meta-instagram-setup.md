# Configurar Meta / Instagram para InstaCaptions

Guía detallada para conectar una cuenta de Instagram a InstaCaptions. Cubre la
creación de la app en Meta, el HTTPS en desarrollo local y un troubleshooting de
los errores más habituales.

InstaCaptions usa el flujo nuevo **Instagram API con Instagram Login** (no el
viejo Facebook Login + Instagram Graph API). El token va directo a la cuenta de
Instagram Business: **no** hace falta vincular Instagram a una página de Facebook
ni pasar verificación de negocio.

---

## Paso previo: cuenta de Instagram profesional

La cuenta de Instagram debe ser de tipo **Profesional (Business o Creator)**. En
la app de Instagram: *Editar perfil → Cambiar a cuenta profesional → Empresa*.
No hace falta vincularla a una página de Facebook.

---

## 1. Crear la app

En [developers.facebook.com/apps](https://developers.facebook.com/apps) →
**Create App**. El flujo nuevo de Meta pide elegir un **caso de uso**, no un tipo
de app. Elige **"Administrar mensajes y contenido en Instagram"** (en inglés:
*Manage messaging & content on Instagram*).

A pesar del nombre, es el caso de uso correcto: provisiona la app para la
**Instagram API con Instagram Login**, que es la que InstaCaptions necesita para
leer posts y publicar contenido.

## 2. Información básica

Sidebar: **Configuración de la aplicación → Información básica**.

- **Dominios de la aplicación**: añade el dominio público que vayas a usar (ver
  [HTTPS en local](#https-en-desarrollo-local)).
- **Añadir plataforma**: elige **Sitio web** y pon la URL pública de la app.
- **Correo de contacto**: rellénalo (es obligatorio).

## 3. Instagram App ID y Secret (NO los de Facebook)

> **Este es el punto que más confusión genera.** El App ID / Secret que aparecen
> en *Información básica* son los de **Facebook**, y **no** funcionan con el flujo
> de Instagram Login: devuelven `Invalid platform app`.

Las credenciales correctas están en:

**Casos de uso → Personalizar → API de Instagram → Configuración de la API con el
inicio de sesión empresarial de Instagram**

Ahí aparecen (son distintos de los de Facebook, aunque vivan dentro de la misma
app de Meta):

- **Identificador de la aplicación de Instagram** → `META_APP_ID`
- **Clave secreta de la aplicación de Instagram** → `META_APP_SECRET`

## 4. Permisos

En la misma pantalla *Personalizar el caso de uso*:

1. Pulsa **"Add all required permissions"**. Esto añade `instagram_business_basic`,
   `instagram_business_manage_comments` e `instagram_business_manage_messages`.
2. Añade manualmente **`instagram_business_content_publish`** desde *Go to
   permissions and features*. Es el que permite publicar y InstaCaptions lo
   necesita.

InstaCaptions solo usa `instagram_business_basic` (leer perfil y media) y
`instagram_business_content_publish` (publicar). Los de comentarios/mensajes no
estorban; si quieres pedirlos, ajusta `OAUTH_SCOPES` en `src/lib/instagram.ts`.

## 5. Añadir la cuenta de Instagram como tester

Sidebar: **Roles de la aplicación → Roles** → pestaña **Instagram testers** →
**Añadir Instagram tester** → introduce el `@username` de la cuenta que vayas a
conectar.

Después, **desde la app de Instagram** (no desde Facebook), la cuenta debe aceptar
la invitación: *Configuración → Aplicaciones y sitios web → Invitaciones de tester
→ Aceptar*.

Sin este paso, *Genera identificadores de acceso* da el error
`Insufficient Developer Role`. En modo desarrollo solo funcionan cuentas con rol;
para terceros hay que pasar **App Review**.

## 6. Inicio de sesión empresarial (redirect URI)

*Personalizar el caso de uso* → **Paso 4: Configura un inicio de sesión
empresarial de Instagram → Configurar**. Ahí va el redirect URI:

```
{PUBLIC_BASE_URL}/api/instagram/callback
```

> **Instagram Business Login exige HTTPS**, incluso en desarrollo (a diferencia
> del viejo Facebook Login, que aceptaba `http://localhost`). Si intentas guardar
> `http://localhost:...`, Meta lo rechaza con *"Error al guardar los URI de
> redireccionamiento"*. Ver [HTTPS en local](#https-en-desarrollo-local).

El valor tiene que coincidir **carácter por carácter** con `META_REDIRECT_URI`
del `.env`.

## 7. Webhooks y App Review

No hacen falta para InstaCaptions. Salta los pasos 3 (webhooks) y 5 (App Review)
de *Personalizar el caso de uso* mientras pruebes con cuentas tester.

---

## HTTPS en desarrollo local

Instagram Business Login obliga a que el redirect URI sea HTTPS, también en
desarrollo. `http://localhost` ya no se acepta.

### Opción por defecto — ya configurada en el repo

El proyecto incluye [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl)
en `astro.config.ts`, así que `npm run dev` ya sirve en **`https://localhost:4321`**
con un certificado autofirmado. No hay que configurar nada.

La pega: el navegador muestra *"Tu conexión no es privada"* la primera vez.
Acéptalo (*Configuración avanzada → Acceder a localhost*). Tendrás que hacerlo
dos veces: al entrar a la app y cuando Instagram te redirija de vuelta al
`callback`, porque es el mismo certificado autofirmado.

`.env`:
```
PUBLIC_BASE_URL=https://localhost:4321
META_REDIRECT_URI=https://localhost:4321/api/instagram/callback
```
En Meta, registra `https://localhost:4321/api/instagram/callback`.

### Opción A — cloudflared (URL pública, útil para webhooks o demos)

```bash
cloudflared tunnel --url http://localhost:4321
```

Da una URL pública tipo `https://random-name.trycloudflare.com`. Actualiza tres
sitios con esa URL:

1. En Meta (Paso 4 → Configurar): `https://random-name.trycloudflare.com/api/instagram/callback`
2. `.env`: `PUBLIC_BASE_URL=https://random-name.trycloudflare.com`
3. `.env`: `META_REDIRECT_URI=https://random-name.trycloudflare.com/api/instagram/callback`

La URL cambia cada vez que reinicias el túnel (salvo ngrok de pago con subdominio
fijo). Si usas un túnel, desactiva el HTTPS local: el túnel ya habla HTTP plano
con tu `localhost:4321`.

### Opción B — mkcert (certificado de confianza, sin avisos del navegador)

```bash
mkcert -install
mkcert localhost
```

Sustituye en `astro.config.ts` el plugin `basicSsl()` por los certificados
generados:

```ts
import fs from "node:fs";

export default defineConfig({
  // ...
  vite: {
    plugins: [tailwindcss()],
    server: {
      https: {
        key: fs.readFileSync("./localhost-key.pem"),
        cert: fs.readFileSync("./localhost.pem"),
      },
    },
  },
});
```

`.env` igual que en la opción por defecto. Ventaja: el certificado es de
confianza, así que no hay interstitial de "conexión no privada".

### Opción C — Caddy como reverse proxy

Alternativa si prefieres no tocar `astro.config.ts`: Caddy termina el HTTPS y
hace proxy a `http://localhost:4321`. Útil si ya usas Caddy para otras cosas.

### Producción (Railway)

No aplica nada de esto: el dominio de Railway ya es HTTPS por defecto. Solo
asegúrate de que `PUBLIC_BASE_URL` y `META_REDIRECT_URI` usan tu dominio público
`https://…` y que ese redirect URI está registrado en Meta.

---

## Troubleshooting

| Error | Causa y arreglo |
| --- | --- |
| `PLATFORM__INVALID_APP_ID` | Estás usando el **Facebook** App ID en vez del **Instagram** App ID, o el `redirect_uri` enviado no coincide con ninguno registrado en Meta. Usa el Instagram App ID (paso 3) y revisa el redirect URI. |
| `Invalid platform app` | Igual que el anterior: Facebook App ID en un endpoint de Instagram. Usa el Instagram App ID/Secret de *Casos de uso → Personalizar*. |
| `Invalid Scopes: instagram_basic, ...` | El código usa los scopes viejos de Facebook Login. Deben ser `instagram_business_basic,instagram_business_content_publish` (ya migrado en `src/lib/instagram.ts`). |
| `Invalid redirect_uri` (flujo Instagram) | El `redirect_uri` del `.env` no es **exactamente** igual al registrado en Meta. El fallo típico es `http://` vs `https://`, una barra final de más, o una errata (`callbac` por `callback`). |
| `Insufficient Developer Role` (al generar token) | La cuenta de Instagram no es tester todavía, o no aceptaste la invitación **desde la app de Instagram** (paso 5). |
| "Error al guardar los URI de redireccionamiento" (en Meta) | El URI no es HTTPS. Instagram Business Login no acepta `http://localhost`. Ver [HTTPS en local](#https-en-desarrollo-local). |
| `409 { "error": "reconnect" }` desde la API | El token largo caducó (Graph code 190). InstaCaptions lo refresca solo en *Ajustes* si le quedan <7 días; si ya caducó, reconecta desde *Ajustes → Reconectar*. |

### Nota: dos IDs de Instagram distintos

El `user_id` que devuelve el **intercambio de token** (`api.instagram.com`) es un
ID *app-scoped* que **no** sirve para las llamadas Graph. El ID real de la cuenta
profesional —el que se usa como `{ig-user-id}` en `/media` y `/media_publish`— es
el que devuelve `GET https://graph.instagram.com/v23.0/me?fields=user_id`.
InstaCaptions ya guarda el correcto (lo resuelve en el callback con `getMe`).
