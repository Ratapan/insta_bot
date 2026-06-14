import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { TONES } from "./tones";

const MODEL = "claude-sonnet-4-6";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // límite de la API de Claude
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

const SYSTEM_PROMPT = `Eres un copywriter experto en Instagram que escribe captions en español.

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
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("La imagen supera el límite de 5MB de la API de Claude");
  }
  return normalizeImageForClaude(buffer);
}
