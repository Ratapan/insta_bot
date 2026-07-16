# Prueba manual — Asistencias de IA por campo (Fase 3)

Verifica los botones ✨ del editor de posts: excerpt, description, title,
tags y el pie bilingüe de imágenes; el tono, el deshacer, el grounding, el
registro en `generationLog` y los errores (rate limit / sin API key).

## Requisitos

- Dev server: `pnpm dev` → https://localhost:4321, con sesión iniciada.
- `ANTHROPIC_API_KEY` configurada (las asistencias son llamadas pagadas a Claude).
- `PORTFOLIO_*` configuradas — el pie de imagen descarga la foto del bucket.
- Para inspeccionar el log: `pnpm db:studio` (Drizzle Studio) → tabla
  `generation_log`.
- Entrada: **📝 Posts** → editar un post con contenido real, o **+ Nuevo post**.
- La barra ✨ arriba del formulario tiene el **selector de tono** (default
  Narrativo); aplica a título, extracto y captions.

## 1. Excerpt y description (con deshacer)

1. En un post con al menos un bloque de texto, pulsa **✨ Sugerir** junto a
   **Extracto**. Verifica que el campo se rellena con una o dos frases en el
   tono elegido.
2. Si el extracto ya tenía texto, aparece abajo un snackbar **«Extracto
   reemplazado» → Deshacer**. Pulsa **Deshacer** y confirma que vuelve el valor
   anterior.
3. Pulsa **✨ SEO** junto a **Descripción**: debe salir una frase informativa y
   neutra (sin voz editorial ni tono), pensada para buscadores.

## 2. Títulos (elegir uno)

1. Pulsa **✨ Sugerir** junto a **Título**. Aparece un panel con **3 títulos**
   distintos entre sí, en el tono elegido.
2. Haz clic en uno → se aplica al campo (con deshacer si había título). O pulsa
   **Descartar** para cerrar sin cambiar nada.

## 3. Tags (chips)

1. Pulsa **✨ Sugerir** junto a **Tags**: reemplaza los chips por 4-8 tags en
   minúsculas (con deshacer si había tags).
2. Edítalos como siempre: quita con ✕, agrega escribiendo + Enter.

## 4. Pie bilingüe de imagen (grounding)

1. En un bloque **Imagen** cuya URL **sí** esté catalogada (badge distinto de
   "Sin metadata" en el selector), pulsa el **✨** junto al pie. Debe generar un
   pie **editorial** (evocador, no "La imagen muestra…") y rellenar también el
   campo **Pie en inglés**. El resultado debe reflejar lo que hay en la foto (el
   grounding factual del catálogo evita que invente).
2. En un bloque con una imagen **huérfana** (sin doc en `images`), pulsa **✨**:
   debe funcionar igual, solo con la imagen (sin descripción factual).
3. Repite en un **slide** (galería): el ✨ de cada celda genera su pie + `Pie (EN)`.

## 5. Cambiar el tono y regenerar

1. Con un pie ya generado, cambia el **tono** en la barra (p. ej. de Narrativo a
   Mínimo o Técnico) y pulsa **✨** en la misma imagen.
2. Compara el registro: Mínimo → una frase corta; Técnico → mirada de la toma
   (encuadre/luz) **sin** mencionar focal/apertura/ISO. El caption anterior se
   envía como contexto, así que la regeneración lo reescribe, no lo repite.

## 6. Registro en `generationLog`

1. Abre `pnpm db:studio` → `generation_log`. Cada ✨ deja una fila con
   `source = "blog_field"`, `context` = el kind (excerpt/title/…/image_caption),
   `tone` (cuando aplica) y `options` con `{ kind, suggestion }`.

## 7. Errores: rate limit y sin API key

- **Rate limit:** baja temporalmente `ASSISTS_PER_HOUR` a `1` en
  `src/pages/api/portfolio/blog-assist.ts`, guarda, y pulsa ✨ dos veces: la
  segunda muestra el toast **«Llegaste al límite de generaciones por hora»**
  (429 `rate_limited`). Restaura el valor a `20`.
- **Sin API key:** vacía `ANTHROPIC_API_KEY` en `.env` y reinicia el dev server.
  Pulsa ✨: aparece **«La IA no respondió. ¿Está configurada la API key?»**
  (502 `claude_unavailable`) y el resto del editor (crear/editar/guardar) sigue
  funcionando. Vuelve a poner la key.
- **Imagen ajena:** el pie solo acepta URLs del bucket del portfolio; una URL
  externa devuelve `invalid_url` (no debería ocurrir desde la UI, que solo usa
  imágenes del selector).

## Notas

- La IA nunca escribe en la base: llena el campo del formulario; se persiste al
  **guardar** el post. El deshacer restaura el valor previo del campo.
- El caption es bilingüe en una sola generación (`caption` + `caption_en`); el
  inglés es texto público del sitio, no una traducción literal.
- Sin `PORTFOLIO_*`, el pie de imagen falla con `image_fetch_failed`; los campos
  de texto (excerpt/description/title/tags) funcionan igual (solo texto).
