import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { TONES } from "./tones";

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
