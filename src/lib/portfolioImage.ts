// Procesado de imágenes destinadas al portafolio: extracción EXIF (para los
// campos técnicos del doc Image) y conversión a WebP.
//
// IMPORTANTE: extraer el EXIF del buffer ORIGINAL, antes de convertir —
// sharp elimina la metadata al re-encodear, así que el orden importa.

import ExifReader from "exifreader";
import sharp from "sharp";

// Lado largo máximo del WebP publicado. El portfolio sirve la imagen completa
// (galería + lightbox); 2560px cubre pantallas retina sin subir originales de
// cámara de 40MP.
const MAX_PUBLISH_EDGE = 2560;
const WEBP_QUALITY = 80;

/** Campos EXIF con los nombres que usa el modelo Image del portfolio. */
export interface ExifFields {
  focal?: string;
  focalMm?: number;
  apertura?: number;
  iso?: number;
  velocidad?: string;
  camera?: string;
  lens?: string;
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

  const lens = tags.LensModel?.description?.trim();
  if (lens) fields.lens = lens;

  return fields;
}

/**
 * Convierte al WebP que se publica en el bucket: orientación EXIF aplicada,
 * lado largo ≤2560px, calidad 80.
 */
export async function toWebp(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width: MAX_PUBLISH_EDGE,
      height: MAX_PUBLISH_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}
