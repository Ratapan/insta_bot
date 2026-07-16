import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { BLOG_TONES, TONES } from "./tones";

const MODEL = "claude-sonnet-4-6";
// Cap defensivo para la descarga cruda (CDN de Instagram). No es el límite de
// 5MB de la API de Claude: normalizeImageForClaude re-encodea a JPEG de 768px
// antes de enviarla, así que solo protege memoria/sharp de archivos enormes.
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
// Lado largo al que reducimos antes de mandar a Claude. Claude cobra por
// dimensiones en píxeles, no por bytes (tokens ≈ ancho×alto/750), así que
// reducir la resolución es lo único que ahorra tokens. 768px es el punto dulce:
// el modelo sigue reconociendo la escena para el caption con ~40% menos input.
const MAX_IMAGE_EDGE = 768;

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export interface CaptionOption {
  caption: string;
  style: string;
}

export interface GenerateCaptionsInput {
  imageBase64: string;
  imageMediaType: SupportedImageType;
  context?: string;
  tone: string;
  withHashtags: boolean;
}

const client = new Anthropic({
  apiKey: import.meta.env.ANTHROPIC_API_KEY,
  maxRetries: 3, // reintenta automáticamente ante rate limits y errores 5xx
});

const SYSTEM_PROMPT = `Eres un copywriter experto en Instagram que escribe captions en español, idealmente un poco chileno.

Reglas:
- Devuelve SIEMPRE y ÚNICAMENTE un JSON válido con esta forma exacta:
  {"options":[{"caption":"...","style":"..."},{"caption":"...","style":"..."},{"caption":"...","style":"..."}]}
- Exactamente 3 opciones, claramente distintas entre sí en enfoque y longitud
  (una corta, una media, una más elaborada), todas dentro del tono pedido.
- "style" es una etiqueta de 2-4 palabras en español que resume el enfoque de esa opción.
- Escribe en español de España, natural, sin sonar a anuncio salvo que el tono lo pida.
- Usa emojis con moderación y solo si encajan con el tono.
- No inventes datos que no estén en la imagen o el contexto del usuario.
- No uses comillas tipográficas dentro de los captions.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`;

export class CaptionGenerationError extends Error {
  constructor(
    message: string,
    public reason: "parse" | "api",
  ) {
    super(message);
    this.name = "CaptionGenerationError";
  }
}

function buildUserPrompt(input: GenerateCaptionsInput): string {
  const tone = TONES.find((t) => t.id === input.tone);
  const lines = [
    `Tono pedido: ${tone ? `${tone.label} — ${tone.hint}` : input.tone}`,
  ];
  if (input.context?.trim()) {
    lines.push(`Contexto del usuario sobre la foto: ${input.context.trim()}`);
  } else {
    lines.push(
      "El usuario no ha dado contexto: básate solo en lo que ves en la imagen.",
    );
  }
  lines.push(
    input.withHashtags
      ? "Incluye al final de cada caption entre 3 y 5 hashtags relevantes en español."
      : "No incluyas ningún hashtag.",
  );
  lines.push("Genera las 3 opciones de caption para esta imagen.");
  return lines.join("\n");
}

function parseOptions(raw: string): CaptionOption[] {
  // Tolera que el modelo envuelva el JSON en un bloque de código.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as { options?: unknown };
  if (!Array.isArray(parsed.options) || parsed.options.length === 0) {
    throw new Error("missing options");
  }
  return parsed.options.slice(0, 3).map((opt) => {
    const o = opt as Record<string, unknown>;
    if (typeof o.caption !== "string" || o.caption.length === 0) {
      throw new Error("invalid option");
    }
    return {
      caption: o.caption,
      style: typeof o.style === "string" ? o.style : "",
    };
  });
}

export function isSupportedImageType(
  contentType: string,
): contentType is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export async function generateCaptions(
  input: GenerateCaptionsInput,
): Promise<CaptionOption[]> {
  const ATTEMPTS = 2; // segundo intento solo si el JSON viene malformado
  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let text: string;
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: input.imageMediaType,
                  data: input.imageBase64,
                },
              },
              { type: "text", text: buildUserPrompt(input) },
            ],
          },
        ],
      });
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (err) {
      console.error("[claude] API error", err);
      throw new CaptionGenerationError(
        "La API de Claude no respondió tras varios reintentos.",
        "api",
      );
    }

    try {
      return parseOptions(text);
    } catch (err) {
      lastError = err;
      console.warn(`[claude] JSON malformado (intento ${attempt})`, text);
    }
  }

  console.error("[claude] parse failed", lastError);
  throw new CaptionGenerationError(
    "Claude no devolvió un JSON válido tras dos intentos.",
    "parse",
  );
}

// ---------------------------------------------------------------------------
// Metadata bilingüe para el portafolio (javiersabando.lat)
// ---------------------------------------------------------------------------

/** Metadata que genera Claude para el doc Image del portfolio. */
export interface PortfolioMetadata {
  caption: string;
  caption_en: string;
  footer: string;
  footer_en: string;
  category: string;
  categories: string[];
}

const PORTFOLIO_SYSTEM_PROMPT = `Eres el catalogador del portafolio fotográfico de Javier Sabando.
Analiza la imagen y devuelve SIEMPRE y ÚNICAMENTE un JSON válido con esta forma exacta:
{"caption":"...","caption_en":"...","footer":"...","footer_en":"...","category":"...","categories":["..."]}

Reglas:
- caption: una frase corta en español (máx ~90 caracteres) que describe la imagen,
  p. ej. "La imagen muestra varias gallinas en un corral".
- footer: descripción extendida en español que complementa el caption (1-3 frases),
  como continuación natural del caption.
- caption_en / footer_en: traducción natural al inglés (no literal).
- category: UNA categoría principal, en minúsculas, en español.
- categories: de 2 a 5 etiquetas en minúsculas en español; la primera debe ser igual a category.
- No inventes datos que no se vean en la imagen.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`;

function parsePortfolioMetadata(raw: string): PortfolioMetadata {
  // Tolera que el modelo envuelva el JSON en un bloque de código.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  for (const field of ["caption", "caption_en", "footer", "footer_en", "category"]) {
    if (typeof parsed[field] !== "string" || (parsed[field] as string).length === 0) {
      throw new Error(`invalid field: ${field}`);
    }
  }
  if (!Array.isArray(parsed.categories) || parsed.categories.length === 0) {
    throw new Error("invalid field: categories");
  }

  const category = (parsed.category as string).toLowerCase().trim();
  const categories = parsed.categories
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.toLowerCase().trim());
  // Garantiza el invariante "la primera etiqueta es la categoría principal".
  if (categories[0] !== category) categories.unshift(category);

  return {
    caption: parsed.caption as string,
    caption_en: parsed.caption_en as string,
    footer: parsed.footer as string,
    footer_en: parsed.footer_en as string,
    category,
    categories: [...new Set(categories)],
  };
}

export interface GeneratePortfolioMetadataInput {
  imageBase64: string;
  imageMediaType: SupportedImageType;
  /** Categorías ya usadas en el portafolio; Claude las prefiere a inventar. */
  existingCategories: string[];
  /** Contexto opcional del usuario sobre la foto. */
  context?: string;
}

export async function generatePortfolioMetadata(
  input: GeneratePortfolioMetadataInput,
): Promise<PortfolioMetadata> {
  const lines: string[] = [];
  if (input.existingCategories.length > 0) {
    lines.push(
      `Categorías existentes del portafolio (prefiérelas; solo crea una nueva si ninguna encaja): ${input.existingCategories.join(", ")}`,
    );
  }
  if (input.context?.trim()) {
    lines.push(`Contexto del usuario sobre la foto: ${input.context.trim()}`);
  }
  lines.push("Genera la metadata para esta imagen.");

  const ATTEMPTS = 2; // segundo intento solo si el JSON viene malformado
  let lastError: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let text: string;
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: PORTFOLIO_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: input.imageMediaType,
                  data: input.imageBase64,
                },
              },
              { type: "text", text: lines.join("\n") },
            ],
          },
        ],
      });
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (err) {
      console.error("[claude] API error", err);
      throw new CaptionGenerationError(
        "La API de Claude no respondió tras varios reintentos.",
        "api",
      );
    }

    try {
      return parsePortfolioMetadata(text);
    } catch (err) {
      lastError = err;
      console.warn(`[claude] JSON malformado (intento ${attempt})`, text);
    }
  }

  console.error("[claude] parse failed", lastError);
  throw new CaptionGenerationError(
    "Claude no devolvió un JSON válido tras dos intentos.",
    "parse",
  );
}

// ---------------------------------------------------------------------------
// Catalogación en lote de una sesión del portafolio (Fase 3)
// ---------------------------------------------------------------------------

/** Una imagen dentro de una tanda del lote. */
export interface BatchImageInput {
  /** Nombre de archivo; Claude lo devuelve tal cual como clave del item. */
  file: string;
  imageBase64: string;
  imageMediaType: SupportedImageType;
  /** Nota de serie legible, p. ej. "Serie A, posición 2 de 3". */
  seriesNote?: string;
}

/** Metadata propuesta para una imagen del lote (sin validar contra vocabulario). */
export interface BatchItemMetadata {
  file: string;
  caption: string;
  caption_en: string;
  footer: string;
  footer_en: string;
  categories: string[];
}

const BATCH_SYSTEM_PROMPT = `Eres el catalogador del portafolio fotográfico de Javier Sabando. Vas a catalogar una sesión de fotos completa, que te llegará por tandas dentro de esta misma conversación.

Para CADA imagen de la tanda devuelve su metadata. Responde SIEMPRE y ÚNICAMENTE con un JSON válido de esta forma exacta:
{"items":[{"file":"...","caption":"...","caption_en":"...","footer":"...","footer_en":"...","categories":["...","..."]}]}

Reglas:
- "file": cópialo EXACTAMENTE como se te indica junto a cada imagen.
- caption: una frase corta en español (máx ~90 caracteres) que describe la imagen.
- footer: descripción extendida en español (1-3 frases), continuación natural del caption.
- caption_en / footer_en: traducción natural al inglés (no literal).
- categories: de 2 a 5 etiquetas en minúsculas en español, de más a menos relevante; la primera es la categoría principal.
- Prefiere las categorías del vocabulario que se te da; solo propone una nueva si ninguna encaja.
- Mantén un estilo consistente en TODA la sesión (mismas convenciones que tus tandas anteriores).
- Si una imagen pertenece a una serie (se indica junto a ella), los footers de la serie deben compartir el mismo texto base y los captions complementarse entre sí.
- No inventes datos que no se vean en la imagen o el contexto.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`;

function parseBatchItems(raw: string, expectedFiles: string[]): BatchItemMetadata[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as { items?: unknown };
  const list = Array.isArray(parsed.items) ? parsed.items : null;
  if (!list) throw new Error("missing items");

  const byFile = new Map<string, BatchItemMetadata>();
  for (const entry of list) {
    const o = entry as Record<string, unknown>;
    for (const field of ["file", "caption", "caption_en", "footer", "footer_en"]) {
      if (typeof o[field] !== "string" || (o[field] as string).trim().length === 0) {
        throw new Error(`invalid field: ${field}`);
      }
    }
    if (!Array.isArray(o.categories)) throw new Error("invalid field: categories");
    const categories = [
      ...new Set(
        o.categories
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.toLowerCase().trim()),
      ),
    ];
    if (categories.length === 0) throw new Error("invalid field: categories");
    byFile.set((o.file as string).trim(), {
      file: (o.file as string).trim(),
      caption: (o.caption as string).trim(),
      caption_en: (o.caption_en as string).trim(),
      footer: (o.footer as string).trim(),
      footer_en: (o.footer_en as string).trim(),
      categories,
    });
  }

  // Todas las imágenes pedidas deben venir; las sobrantes se ignoran.
  const items: BatchItemMetadata[] = [];
  for (const file of expectedFiles) {
    const item = byFile.get(file);
    if (!item) throw new Error(`missing item for ${file}`);
    items.push(item);
  }
  return items;
}

/**
 * Conversación de catalogación en lote: cada `next(tanda)` es un turno más de
 * la MISMA conversación, para que Claude mantenga estilo y vocabulario en toda
 * la sesión. Tras procesar una tanda, sus imágenes se sustituyen en el
 * historial por un resumen de texto (la coherencia viene de que el modelo ve
 * sus propias respuestas; re-enviar los píxeles de tandas pasadas solo
 * multiplicaría el costo por tanda).
 */
export function createPortfolioBatchConversation(opts: {
  /** Contexto de la(s) sesión(es), escrito por el fotógrafo. */
  sessionContext?: string;
  /** Vocabulario de categorías preferido (tags + categorías en uso). */
  vocabulary: string[];
}) {
  const messages: Anthropic.MessageParam[] = [];
  let chunkNumber = 0;

  return {
    async next(images: BatchImageInput[]): Promise<BatchItemMetadata[]> {
      chunkNumber += 1;
      const expectedFiles = images.map((img) => img.file);

      const headerLines: string[] = [];
      if (chunkNumber === 1) {
        if (opts.sessionContext?.trim()) {
          headerLines.push(`Contexto de la sesión: ${opts.sessionContext.trim()}`);
        }
        if (opts.vocabulary.length > 0) {
          headerLines.push(
            `Vocabulario de categorías del portafolio: ${opts.vocabulary.join(", ")}`,
          );
        }
        headerLines.push(`Tanda 1: ${images.length} imágenes. Genera la metadata de cada una.`);
      } else {
        headerLines.push(
          `Tanda ${chunkNumber}: ${images.length} imágenes más de la misma sesión. Mantén el estilo de las tandas anteriores.`,
        );
      }

      const content: Anthropic.ContentBlockParam[] = [
        { type: "text", text: headerLines.join("\n") },
      ];
      for (const img of images) {
        content.push({
          type: "text",
          text: `file: ${img.file}${img.seriesNote ? ` — ${img.seriesNote}` : ""}`,
        });
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.imageMediaType,
            data: img.imageBase64,
          },
        });
      }
      messages.push({ role: "user", content });

      const ATTEMPTS = 2; // segundo intento solo si el JSON viene malformado
      let lastError: unknown;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        let text: string;
        try {
          const response = await client.messages.create({
            model: MODEL,
            max_tokens: 4000,
            system: BATCH_SYSTEM_PROMPT,
            messages,
          });
          text = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        } catch (err) {
          console.error("[claude] API error (batch)", err);
          messages.pop(); // no dejar la tanda fallida en el historial
          throw new CaptionGenerationError(
            "La API de Claude no respondió tras varios reintentos.",
            "api",
          );
        }

        try {
          const items = parseBatchItems(text, expectedFiles);
          // Compacta la tanda en el historial: fuera píxeles, queda el resumen.
          messages[messages.length - 1] = {
            role: "user",
            content: `(Tanda ${chunkNumber} enviada: ${expectedFiles.join(", ")} — imágenes omitidas del historial.)`,
          };
          messages.push({ role: "assistant", content: text });
          return items;
        } catch (err) {
          lastError = err;
          console.warn(`[claude] JSON malformado en batch (intento ${attempt})`, text);
        }
      }

      messages.pop();
      console.error("[claude] batch parse failed", lastError);
      throw new CaptionGenerationError(
        "Claude no devolvió un JSON válido tras dos intentos.",
        "parse",
      );
    },
  };
}

/**
 * Reduce el lado largo a `MAX_IMAGE_EDGE` (sin agrandar) y re-encodea a JPEG,
 * aplanando la transparencia sobre blanco. Baja los tokens que cobra Claude
 * (cobra por dimensiones, no por bytes) y elimina de raíz el límite de 5MB.
 * Acepta de entrada JPG/PNG/GIF/WebP; siempre devuelve JPEG.
 */
export async function normalizeImageForClaude(buffer: Buffer): Promise<{
  base64: string;
  mediaType: SupportedImageType;
}> {
  const out = await sharp(buffer)
    .rotate() // aplica la orientación EXIF (fotos de móvil) antes de redimensionar
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" }) // PNG/WebP con alfa → fondo blanco
    .jpeg({ quality: 82 })
    .toBuffer();
  return { base64: out.toString("base64"), mediaType: "image/jpeg" };
}

/**
 * Descarga una imagen (p. ej. del CDN de Instagram) y la prepara para Claude.
 * La normaliza con `normalizeImageForClaude`, así que el resultado es JPEG
 * redimensionado independientemente del formato de origen.
 */
export async function downloadImageAsBase64(url: string): Promise<{
  base64: string;
  mediaType: SupportedImageType;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen (HTTP ${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("La imagen descargada supera el límite de 15MB");
  }
  return normalizeImageForClaude(buffer);
}

// ---------------------------------------------------------------------------
// Asistencias de IA por campo del editor de blogs (Fase 3)
// ---------------------------------------------------------------------------
// La escritura a generationLog (source: "blog_field") la hace la ruta, no aquí.

function stripCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

/**
 * Bucle de generación JSON compartido por las asistencias de blog: una llamada,
 * reintento único si el JSON viene malformado, mismos errores string que el
 * resto de claude.ts (CaptionGenerationError reason "api" | "parse").
 */
async function generateBlogJson<T>(
  system: string,
  content: Anthropic.ContentBlockParam[],
  maxTokens: number,
  parse: (raw: string) => T,
): Promise<T> {
  const ATTEMPTS = 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let text: string;
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
      });
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (err) {
      console.error("[claude] API error (blog)", err);
      throw new CaptionGenerationError(
        "La API de Claude no respondió tras varios reintentos.",
        "api",
      );
    }
    try {
      return parse(text);
    } catch (err) {
      lastError = err;
      console.warn(`[claude] JSON malformado en blog (intento ${attempt})`, text);
    }
  }
  console.error("[claude] blog parse failed", lastError);
  throw new CaptionGenerationError(
    "Claude no devolvió un JSON válido tras dos intentos.",
    "parse",
  );
}

// --- Campos de texto: excerpt / description / title / tags ---

export type BlogFieldKind = "excerpt" | "description" | "title" | "tags";

export interface GenerateBlogFieldInput {
  kind: BlogFieldKind;
  /** Título actual del post (puede estar vacío). */
  title: string;
  /** Contenido del post como texto plano (sin HTML ni imágenes). */
  contentText: string;
  /** Solo lo usan excerpt y title. */
  tone?: string;
}

const BLOG_FIELD_SYSTEM: Record<BlogFieldKind, string> = {
  excerpt: `Eres editor del blog fotográfico de Javier Sabando. Escribes el EXTRACTO de un post: el gancho que se lee en la lista y las tarjetas.
Devuelve SIEMPRE y ÚNICAMENTE un JSON válido: {"excerpt":"..."}
Reglas:
- Español, una o dos frases (máx ~300 caracteres), dentro del tono pedido.
- Invita a leer sin exagerar ni spoilear; nada de "En este post" ni "Aquí te cuento".
- No inventes datos que no estén en el título o el contenido que se te da.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`,
  description: `Eres editor del blog fotográfico de Javier Sabando. Escribes la DESCRIPCIÓN (meta) del post, pensada para buscadores.
Devuelve SIEMPRE y ÚNICAMENTE un JSON válido: {"description":"..."}
Reglas:
- Español, una o dos frases (máx ~160 caracteres), clara e informativa: resume de qué trata el post, sin gancho ni voz editorial.
- Menciona de forma natural el tema y el lugar si aparecen en el contenido; no inventes.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`,
  title: `Eres editor del blog fotográfico de Javier Sabando. Propones TÍTULOS para un post a partir de su contenido.
Devuelve SIEMPRE y ÚNICAMENTE un JSON válido: {"titles":["...","...","..."]}
Reglas:
- Exactamente 3 títulos en español, claramente distintos entre sí (enfoque y largo), todos dentro del tono pedido.
- Concretos y atractivos; nada de clickbait ni signos de exclamación. Máx ~70 caracteres cada uno.
- Básate en el contenido dado; no inventes lugares ni hechos.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`,
  tags: `Eres editor del blog fotográfico de Javier Sabando. Propones TAGS (temas) para un post a partir de su contenido.
Devuelve SIEMPRE y ÚNICAMENTE un JSON válido: {"tags":["...","..."]}
Reglas:
- De 4 a 8 tags en español, en minúsculas, de una o dos palabras cada uno.
- Temas, lugares y motivos presentes en el contenido; concretos y sin repetir.
- Es una lista libre, no un vocabulario cerrado.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`,
};

const BLOG_FIELD_INSTRUCTION: Record<BlogFieldKind, string> = {
  excerpt: "Genera el extracto del post.",
  description: "Genera la descripción (meta) del post.",
  title: "Propón los 3 títulos.",
  tags: "Propón los tags.",
};

function parseBlogField(kind: BlogFieldKind, raw: string): string | string[] {
  const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
  if (kind === "excerpt" || kind === "description") {
    const value = parsed[kind];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`invalid field: ${kind}`);
    }
    return value.trim();
  }
  const key = kind === "title" ? "titles" : "tags";
  const arr = parsed[key];
  if (!Array.isArray(arr)) throw new Error(`invalid field: ${key}`);
  const items = [
    ...new Set(
      arr
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim()),
    ),
  ];
  if (items.length === 0) throw new Error(`invalid field: ${key}`);
  return kind === "title" ? items.slice(0, 3) : items.slice(0, 8);
}

/**
 * Sugerencia para un campo de texto del post. Devuelve string
 * (excerpt/description) o string[] (title/tags). No envía la imagen ni HTML:
 * solo el título y el contenido en texto plano (el tono aplica a excerpt/title).
 */
export async function generateBlogFieldSuggestion(
  input: GenerateBlogFieldInput,
): Promise<string | string[]> {
  const lines: string[] = [];
  if (input.title.trim()) lines.push(`Título del post: ${input.title.trim()}`);
  if ((input.kind === "excerpt" || input.kind === "title") && input.tone) {
    const tone = BLOG_TONES.find((t) => t.id === input.tone);
    lines.push(`Tono pedido: ${tone ? `${tone.label} — ${tone.hint}` : input.tone}`);
  }
  lines.push(
    `Contenido del post (texto plano):\n${input.contentText.trim() || "(sin contenido todavía)"}`,
  );
  lines.push(BLOG_FIELD_INSTRUCTION[input.kind]);

  const maxTokens = input.kind === "title" || input.kind === "tags" ? 600 : 500;
  return generateBlogJson(
    BLOG_FIELD_SYSTEM[input.kind],
    [{ type: "text", text: lines.join("\n\n") }],
    maxTokens,
    (raw) => parseBlogField(input.kind, raw),
  );
}

// --- Caption bilingüe de una imagen (voz editorial, no de catálogo) ---

export interface GenerateBlogImageCaptionInput {
  imageBase64: string;
  imageMediaType: SupportedImageType;
  tone: string;
  /** caption + footer de catálogo (colección images) si la url está catalogada. */
  factualDescription?: string;
  /** context de la sesión (colección sessions) si existe. */
  sessionContext?: string;
  /** Contexto del post donde vive el caption. */
  postTitle?: string;
  postExcerpt?: string;
  /** Texto plano del bloque de texto que precede a la imagen (se trunca). */
  precedingText?: string;
  /** Caption actual del bloque, al regenerar. */
  currentCaption?: string;
}

const BLOG_CAPTION_SYSTEM = `Eres quien escribe los captions EDITORIALES del blog fotográfico de Javier Sabando (javiersabando.lat). No catalogas la imagen: la acompañas con una línea que le da sentido dentro del relato del post.

Devuelve SIEMPRE y ÚNICAMENTE un JSON válido con esta forma exacta:
{"caption":"...","caption_en":"..."}

Dos voces — no las confundas:
- Voz de CATÁLOGO (la que NO debes usar): describe literalmente, hace inventario. Ej.: "La imagen muestra un pato gris posado sobre unas rocas con musgo", "Grupo de pingüinos posados sobre un terreno rocoso bajo un cielo despejado".
- Voz EDITORIAL (la tuya): evoca y conecta con el momento o el relato del post, con una imagen literaria. Ej.: "Un ave permanece inmóvil entre rocas cubiertas de algas, en equilibrio constante entre tierra y agua", "Un grupo de pingüinos asciende por la roca como si siguiera una coreografía aprendida de memoria".

Reglas:
- caption: en español, una o dos frases dentro del tono pedido; en tono mínimo, una sola y corta. Prohibido empezar con "La imagen muestra", "Se observa", "En la foto", "Aquí vemos". No enumeres colores ni posiciones salvo que aporten al sentido.
- No inventes hechos. Se te entrega el contexto del post y una DESCRIPCIÓN FACTUAL de lo que hay en la foto (y, si existe, el contexto de la sesión): trátalos como verdad. No afirmes lugares, especies, nombres ni fechas que no estén en esos datos o no sean evidentes en la imagen; ante la duda, quédate en lo sensorial.
- En tono técnico puedes apoyarte en la decisión de la toma que se ve en la imagen (encuadre, luz, momento elegido), pero NO afirmes datos que no se ven: nada de focal, apertura, ISO ni velocidad — eso lo enriquece el sitio desde el EXIF real.
- caption_en: inglés natural y cuidado —es texto público del sitio—, mismo registro editorial. NO una traducción literal; que suene escrito en inglés.
- Sin hashtags, sin emojis, sin comillas tipográficas.
- Si se te da un caption actual, es para reescribirlo mejor en el tono pedido, no para repetirlo.
- Nada de texto fuera del JSON: ni explicaciones, ni markdown, ni bloques de código.`;

function buildBlogCaptionPrompt(input: GenerateBlogImageCaptionInput): string {
  const tone = BLOG_TONES.find((t) => t.id === input.tone);
  const lines = [`Tono pedido: ${tone ? `${tone.label} — ${tone.hint}` : input.tone}`];

  const post = [input.postTitle?.trim(), input.postExcerpt?.trim()]
    .filter(Boolean)
    .join(". ");
  if (post) lines.push(`Post: ${post}`);
  if (input.precedingText?.trim()) {
    lines.push(`Texto que precede a la imagen: ${input.precedingText.trim().slice(0, 300)}`);
  }
  if (input.factualDescription?.trim()) {
    lines.push(
      `Descripción factual de la foto (no la copies, es solo para no inventar): ${input.factualDescription.trim()}`,
    );
  }
  if (input.sessionContext?.trim()) {
    lines.push(`Contexto de la sesión: ${input.sessionContext.trim()}`);
  }
  if (input.currentCaption?.trim()) {
    lines.push(
      `Caption actual del bloque (reescríbelo mejor en el tono pedido): ${input.currentCaption.trim()}`,
    );
  }
  lines.push("Escribe el caption editorial bilingüe para esta imagen.");
  return lines.join("\n");
}

function parseBlogCaption(raw: string): { caption: string; caption_en: string } {
  const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
  for (const field of ["caption", "caption_en"]) {
    if (typeof parsed[field] !== "string" || (parsed[field] as string).trim().length === 0) {
      throw new Error(`invalid field: ${field}`);
    }
  }
  return {
    caption: (parsed.caption as string).trim(),
    caption_en: (parsed.caption_en as string).trim(),
  };
}

/**
 * Caption bilingüe editorial (voz de blog, no de catálogo) para una imagen del
 * post. Recibe la imagen ya normalizada y el grounding en texto (contexto del
 * post, texto precedente, descripción factual del catálogo, contexto de sesión);
 * todo es best-effort: lo que no venga, se omite.
 */
export async function generateBlogImageCaption(
  input: GenerateBlogImageCaptionInput,
): Promise<{ caption: string; caption_en: string }> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: input.imageMediaType,
        data: input.imageBase64,
      },
    },
    { type: "text", text: buildBlogCaptionPrompt(input) },
  ];
  return generateBlogJson(BLOG_CAPTION_SYSTEM, content, 800, parseBlogCaption);
}
