// Procesado de imágenes del portafolio: extracción EXIF (campos técnicos del
// doc Image), conversión a WebP y "facts" del WebP publicado (dimensiones y
// color promedio, que el sitio usa para reservar el hueco y el placeholder).
//
// EXIF y privacidad: toWebp() reescribe en el WebP publicado SOLO los campos de
// cámara (marca, modelo, exposición, focal, ISO, lente, fecha de captura) y
// JAMÁS los de GPS ni ubicación — las fotos del portfolio son públicas. Antes esta conversión
// borraba toda la metadata; ahora la conserva de forma SELECTIVA para que una
// imagen del bucket se pueda recatalogar por su EXIF (ver analyzeImageFromUrl) y
// para que convivan los dos linajes (WebP convertidos afuera con EXIF + los que
// genera la app) en "WebP con metadata de cámara, sin GPS".
//
// La extracción para el doc de Mongo se hace sobre el buffer ORIGINAL
// (extractExif), no sobre el WebP: el original trae el EXIF completo, así el
// orden de subida (EXIF → WebP) no depende de qué preserve sharp.

import ExifReader from "exifreader";
import sharp from "sharp";

// Lado largo máximo del WebP publicado. El portfolio sirve la imagen completa
// (galería + lightbox); 2560px cubre pantallas retina sin subir originales de
// cámara de 40MP.
const MAX_PUBLISH_EDGE = 2560;
const WEBP_QUALITY = 80;

// Valores placeholder de EXIF que equivalen a "sin dato". Las cámaras bridge
// (p. ej. la Lumix DMC-FZ300, de lente fijo) escriben "N/A" en LensModel; eso
// no es un lente real, así que se normaliza a ausente.
const EXIF_PLACEHOLDERS = new Set(["n/a", "na", "n.a.", "----", "--", "-", "unknown", "none"]);

/** Limpia un texto de EXIF: trim y descarta placeholders → undefined. */
function cleanExifText(value: unknown): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || EXIF_PLACEHOLDERS.has(s.toLowerCase())) return undefined;
  return s;
}

/** Campos EXIF con los nombres que usa el modelo Image del portfolio. */
export interface ExifFields {
  focal?: string;
  focalMm?: number;
  apertura?: number;
  iso?: number;
  velocidad?: string;
  camera?: string;
  lens?: string;
  takenAt?: Date;
}

// "YYYY:MM:DD HH:MM:SS" (formato EXIF; algunos exportadores usan "T").
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * Fecha EXIF → Date. El EXIF no trae zona horaria: se toma la hora de pared de
 * la cámara como si fuera UTC (sirve para ordenar y agrupar por día sin
 * inventar una zona). Descarta placeholders como "0000:00:00 00:00:00".
 */
export function parseExifDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string") return undefined;
  const m = EXIF_DATE.exec(raw.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
    return undefined;
  }
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC desborda días imposibles (31 de febrero → marzo): se descartan.
  return date.getUTCDate() === d ? date : undefined;
}

/**
 * Extrae los campos técnicos del EXIF. Best-effort: una imagen sin EXIF
 * (capturas, exportes web) devuelve un objeto vacío, nunca lanza.
 */
export function extractExif(buffer: Buffer): ExifFields {
  let tags: ExifReader.Tags;
  try {
    tags = ExifReader.load(buffer);
  } catch {
    return {};
  }

  const fields: ExifFields = {};

  // focalMm numérico (ordenar/filtrar) + focal de display canónico "50 mm",
  // con espacio: es el formato de los docs existentes del portfolio.
  const focalRaw = tags.FocalLength?.description;
  if (focalRaw) {
    const mm = Number.parseFloat(String(focalRaw));
    if (Number.isFinite(mm) && mm > 0) {
      fields.focalMm = mm;
      fields.focal = `${mm} mm`;
    } else {
      fields.focal = String(focalRaw).trim();
    }
  }

  // "f/2.8" → 2.8
  const fnumber = tags.FNumber?.description;
  if (fnumber) {
    const apertura = Number.parseFloat(fnumber.replace(/^f\//i, ""));
    if (Number.isFinite(apertura)) fields.apertura = apertura;
  }

  const iso = Number(tags.ISOSpeedRatings?.description);
  if (Number.isFinite(iso) && iso > 0) fields.iso = iso;

  // "1/250" tal cual.
  const velocidad = tags.ExposureTime?.description;
  if (velocidad) fields.velocidad = velocidad;

  const make = tags.Make?.description?.trim();
  const model = tags.Model?.description?.trim();
  if (make || model) {
    // Algunos fabricantes repiten la marca en el modelo ("NIKON NIKON D750").
    const camera =
      model && make && model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : [make, model].filter(Boolean).join(" ");
    fields.camera = camera;
  }

  const lens = cleanExifText(tags.LensModel?.description);
  if (lens) fields.lens = lens;

  const takenAt =
    parseExifDate(tags.DateTimeOriginal?.description) ??
    parseExifDate(tags.DateTimeDigitized?.description);
  if (takenAt) fields.takenAt = takenAt;

  return fields;
}

// --- Facts del WebP publicado ------------------------------------------------

/** Dimensiones visibles y color promedio de una imagen. */
export interface ImageFacts {
  width: number;
  height: number;
  /** Color promedio "#rrggbb" (placeholder mientras carga la foto). */
  color: string;
}

/**
 * Ancho y alto VISIBLES (con la orientación EXIF aplicada) leyendo solo la
 * cabecera, sin decodificar. Los WebP que genera toWebp() ya vienen rotados,
 * pero los convertidos afuera o un original de cámara pueden traer Orientation.
 */
export async function orientedSize(
  buffer: Buffer,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new Error("image_unreadable");
  return { width, height };
}

/**
 * Dimensiones visibles + color promedio (media de cada canal). Se usa el
 * promedio y no el `dominant` de sharp (el tono más frecuente): en fotos con
 * sombras el dominante sale casi negro (#080808) aunque la foto no lo sea, y
 * como placeholder no dice nada. Lanza si sharp no puede leer la imagen.
 */
export async function imageFacts(buffer: Buffer): Promise<ImageFacts> {
  const [{ width, height }, { channels }] = await Promise.all([
    orientedSize(buffer),
    sharp(buffer).stats(),
  ]);
  // Escala de grises (1 canal) → mismo valor en R, G y B; el alfa se ignora.
  const [r, g, b] =
    channels.length >= 3
      ? [channels[0]!.mean, channels[1]!.mean, channels[2]!.mean]
      : [channels[0]!.mean, channels[0]!.mean, channels[0]!.mean];
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return { width, height, color: `#${hex(r)}${hex(g)}${hex(b)}` };
}

/**
 * Descarga un WebP público y devuelve su EXIF y sus facts (una sola descarga).
 * Para catalogar huérfanas y rellenar datos técnicos desde la cola de revisión.
 * Lanza "exif_fetch_failed" si la descarga falla. EXIF y facts son best-effort:
 * sin EXIF → exif = {}; si sharp no puede leer la imagen → facts = null.
 */
export async function analyzeImageFromUrl(
  url: string,
): Promise<{ exif: ExifFields; facts: ImageFacts | null }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("exif_fetch_failed");
  const buffer = Buffer.from(await res.arrayBuffer());
  const facts = await imageFacts(buffer).catch(() => null);
  return { exif: extractExif(buffer), facts };
}

// --- EXIF de cámara para el WebP (sin GPS) ----------------------------------

// Tipo laxo: exifreader tipa los tags como una unión amplia (XmpTag, RationalTag…)
// cuyos `value` no coinciden; aquí solo leemos description/value de forma segura.
type RawExifTag = { description?: unknown; value?: unknown };

const RATIONAL = /^\d+\/\d+$/;

/** "1/250" tal cual; un decimal ("2.8") → racional ("2800/1000"). */
function rationalString(tag: RawExifTag | undefined): string | undefined {
  if (!tag) return undefined;
  const desc = tag.description != null ? String(tag.description) : "";
  if (RATIONAL.test(desc)) return desc;

  const value = (tag as { value?: unknown }).value;
  // exifreader suele dar los racionales como [numerador, denominador].
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    value[1] !== 0
  ) {
    return `${value[0]}/${value[1]}`;
  }

  const num = Number.parseFloat(desc);
  if (!Number.isFinite(num)) return undefined;
  if (Number.isInteger(num)) return `${num}/1`;
  return `${Math.round(num * 1000)}/1000`;
}

function intString(tag: RawExifTag | undefined): string | undefined {
  if (!tag) return undefined;
  const n = Number.parseInt(String(tag.description ?? ""), 10);
  return Number.isFinite(n) ? String(n) : undefined;
}

function textString(tag: RawExifTag | undefined): string | undefined {
  const s = tag?.description;
  if (typeof s === "string" && s.trim() !== "") return s.trim();
  return undefined;
}

/**
 * Construye el objeto EXIF para sharp.withExif con SOLO los campos de cámara.
 * Nunca incluye IFD3 (GPS), así que la ubicación no puede filtrarse. Devuelve
 * undefined si el original no trae ningún campo de cámara.
 */
function cameraExif(buffer: Buffer): sharp.Exif | undefined {
  let tags: ExifReader.Tags;
  try {
    tags = ExifReader.load(buffer);
  } catch {
    return undefined;
  }

  const ifd0: Record<string, string> = {};
  const exifIfd: Record<string, string> = {};

  const make = textString(tags.Make);
  if (make) ifd0.Make = make;
  const model = textString(tags.Model);
  if (model) ifd0.Model = model;

  const exposure = rationalString(tags.ExposureTime);
  if (exposure) exifIfd.ExposureTime = exposure;
  const fnumber = rationalString(tags.FNumber);
  if (fnumber) exifIfd.FNumber = fnumber;
  const iso = intString(tags.ISOSpeedRatings);
  if (iso) exifIfd.ISOSpeedRatings = iso;
  const focal = rationalString(tags.FocalLength);
  if (focal) exifIfd.FocalLength = focal;
  const lens = cleanExifText(tags.LensModel?.description);
  if (lens) exifIfd.LensModel = lens;
  // Fecha de captura ("YYYY:MM:DD HH:MM:SS"): permite el orden cronológico
  // dentro de una sesión y backfill sin volver a los originales. Sin implicación
  // de ubicación, a diferencia del GPS.
  const shotAt = textString(tags.DateTimeOriginal);
  if (shotAt) exifIfd.DateTimeOriginal = shotAt;

  const hasIfd0 = Object.keys(ifd0).length > 0;
  const hasExif = Object.keys(exifIfd).length > 0;
  if (!hasIfd0 && !hasExif) return undefined;

  // IFD0 = imagen principal (Make/Model); IFD2 = sub-IFD Exif (exposición, etc.).
  const exif: sharp.Exif = {};
  if (hasIfd0) exif.IFD0 = ifd0;
  if (hasExif) exif.IFD2 = exifIfd;
  return exif;
}

/**
 * Convierte al WebP que se publica en el bucket: orientación EXIF aplicada
 * (y horneada — no queda tag Orientation que provoque doble rotación), lado
 * largo ≤2560px, calidad 80, y EXIF de cámara SIN GPS (ver comentario cabecera).
 */
export async function toWebp(buffer: Buffer): Promise<Buffer> {
  const pipeline = sharp(buffer)
    .rotate()
    .resize({
      width: MAX_PUBLISH_EDGE,
      height: MAX_PUBLISH_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY });

  const exif = cameraExif(buffer);
  if (exif) pipeline.withExif(exif);

  return pipeline.toBuffer();
}
