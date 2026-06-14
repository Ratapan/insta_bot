import Anthropic from "@anthropic-ai/sdk";
import { TONES } from "./tones";

const MODEL = "claude-sonnet-4-6";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // límite de la API de Claude

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

/** Descarga una imagen (p. ej. del CDN de Instagram) y la convierte a base64. */
export async function downloadImageAsBase64(url: string): Promise<{
  base64: string;
  mediaType: SupportedImageType;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen (HTTP ${res.status})`);
  }
  const contentType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim();
  if (!isSupportedImageType(contentType)) {
    throw new Error(`Tipo de imagen no soportado: ${contentType}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("La imagen supera el límite de 5MB de la API de Claude");
  }
  return { base64: buffer.toString("base64"), mediaType: contentType };
}
