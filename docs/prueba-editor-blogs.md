# Prueba manual — Editor de posts del portafolio (Fase 2)

Verifica el CRUD de posts (colección `blogs`), la normalización de posts legacy,
el selector de imágenes con **Catalogar**, y el EXIF de cámara **sin GPS** al
subir por la app.

## Requisitos

- Dev server: `pnpm dev` → https://localhost:4321, con sesión iniciada.
- Variables `PORTFOLIO_*` configuradas (para el selector de imágenes y la subida
  al bucket). La lista y el editor de metadatos funcionan sin R2; **el selector
  de imágenes no**.
- Para inspeccionar datos: MongoDB Compass/Atlas sobre la base del portafolio
  (colección `blogs`; y `images` para el enriquecido). Un visor de EXIF
  (exiftool o uno online) para el paso 4.
- Entrada: hub del portafolio (`/app/portfolio`) → botón **📝 Posts**.

## 1. Blog con los 5 tipos de bloque, reordenar y publicar

1. **📝 Posts** → **+ Nuevo post**.
2. Rellena **Título** ("Prueba fase 2") y **Extracto**, y elige **Imagen
   principal** (Elegir imagen → navega a una sesión → Elegir).
3. Agrega un bloque de cada tipo con los botones **+ Texto / + Imagen / + Video /
   + Galería / + Código**:
   - **Texto**: escribe HTML, p. ej. `<p>Hola <strong>mundo</strong></p><script>alert(1)</script>`.
   - **Imagen**: Elegir imagen; opcionalmente un pie.
   - **Video**: una URL de embed (`https://www.youtube.com/embed/…`).
   - **Galería**: Agregar imagen (2 o más).
   - **Código**: pega algo; lenguaje opcional.
4. Reordena bloques con **◀ / ▶** (subir / bajar).
5. Estado **Publicado** → **Crear post**.
6. Verifica:
   - Redirige a la edición del post (`/app/portfolio/blogs/{slug}`), con el
     **slug autogenerado** del título (acentos → sin acentos, p. ej.
     "Diseño ágil" → `diseno-agil`).
   - En Mongo `blogs`: `status:"published"`, **`publishedAt` es un Date**
     (rellenado solo), `content` con `order` 0..n, y el bloque de texto **sin**
     `<script>` (sanitizado; conserva `<strong>`).

## 2. Repo con tecnologías

1. **+ Nuevo post** → Tipo **Repo**. Aparecen **GitHub URL**, **Demo URL** y
   **Tecnologías**.
2. Rellena título/extracto/imagen; añade 2-3 tecnologías (chips) y un GitHub URL.
3. **Crear post**. Verifica en `blogs`: `type:"repo"`, `technologies:[…]`,
   `githubUrl`.
4. En el sitio: `https://javiersabando.lat/repo/{slug}`.

## 3. Editar un post legacy y verificar el enriquecido en el sitio real

1. **📝 Posts** → filtro **Estado: Todos** → edita uno de los 3 legacy
   (p. ej. `chiloe-despertar-pasion-fotografica`).
2. Observa que el editor carga los bloques image/slide ya con su imagen visible
   — la forma legacy guardaba `imageUrl`, y el editor lo normaliza a `url` al leer.
3. Cambia algo menor (o solo pulsa **Guardar cambios**).
4. En Mongo `blogs`, ese doc quedó **normalizado**:
   - Bloques image/slide con **`url`** (ya no `imageUrl`).
   - `createdAt` / `updatedAt` / `publishedAt` son **Date** (BSON), no strings.
   - `content` con `order` secuencial 0..n.
5. **Abre el post en el sitio real**: `https://javiersabando.lat/blog/{slug}`
   (si tu sitio usa prefijo de idioma, inclúyelo). Verifica que los bloques
   **image/slide renderizan con su caption y datos EXIF** (cámara, f, ISO…):
   eso confirma que el sitio **enriquece desde `images`** por `url`, aunque el
   editor solo guardó `url`. Valida la cadena completa, no solo el doc limpio.
6. Si alguna imagen del post aparece **sin** caption/EXIF en el sitio, su `url`
   no tiene doc en `images`: ese es el caso natural para **Catalogar** (paso 5)
   — ábrela en el selector de esa imagen y catalógala.

## 4. Subir imagen nueva por la app → WebP con EXIF de cámara, sin GPS

1. En el editor, en **Imagen principal** o un bloque **Imagen** → **Elegir
   imagen** → navega a una sesión → **Subir aquí** → elige un **JPG con EXIF de
   cámara**; idealmente uno **con GPS** (una foto de celular) para verificar que
   se elimina.
2. La imagen aparece; su URL pública es el `.webp` generado.
3. Descarga ese WebP (abre la URL) y míralo con un visor de EXIF:
   - **Debe** traer marca, modelo, exposición, f, ISO, focal, lente y **fecha de
     captura** (`DateTimeOriginal`) — 8 campos.
   - **No debe** traer GPS ni ubicación.
   - Contraste: antes de este cambio, `toWebp()` borraba toda la metadata.

## 5. Catalogar una imagen huérfana

1. Nota: subir por el selector ("Subir aquí") **no** crea el doc en `images` (es
   opcional por imagen). Esa imagen queda **huérfana** (badge "Sin metadata").
2. En el selector, ubica una imagen "Sin metadata" (p. ej. la que subiste en el
   paso 4) y pulsa **Catalogar**.
3. Verifica en `images` un doc nuevo:
   - `visible:false` (regla de revisión — nada se publica sin revisar).
   - Campos de cámara poblados desde el EXIF del WebP (si lo tenía).
   - Si el WebP **no** traía EXIF (p. ej. una captura), el doc se crea igual con
     esos campos vacíos, editable después en **⚡ Revisar**.
4. Al recargar el selector, esa imagen pasa a badge "Oculta".

## Notas

- Nada se publica sin acción explícita: los posts entran `draft`, las imágenes
  catalogadas `visible:false`.
- La lista muestra **todos los estados** por defecto (borradores y archivados
  incluidos); el sitio solo publica los `published`.
- Errores mapeados a español: slug repetido ("Ya existe un post con ese slug"),
  campos inválidos, post inexistente, etc.
- El editor **adelgaza** los bloques legacy al guardar (quita el EXIF
  denormalizado de cada bloque): el sitio lo re-enriquece desde `images`. Si un
  post trajera un bloque de tipo no editable (`file`), el editor avisa arriba y
  ese bloque se perdería al guardar (ninguno de los 3 posts actuales lo tiene).
