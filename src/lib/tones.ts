// Tonos disponibles para la generación de captions.
// Módulo sin dependencias de servidor: lo importan también los componentes Vue.

export interface Tone {
  id: string;
  label: string;
  hint: string;
}

export const TONES: Tone[] = [
  {
    id: "casual",
    label: "Casual",
    hint: "Cercano y natural, como se lo contarías a un amigo.",
  },
  {
    id: "poetico",
    label: "Poético",
    hint: "Evocador, con imágenes y metáforas sutiles.",
  },
  {
    id: "divertido",
    label: "Divertido",
    hint: "Con humor, juegos de palabras o ironía ligera.",
  },
  {
    id: "minimo",
    label: "Mínimo",
    hint: "Muy corto: una palabra, una frase, un emoji justo.",
  },
  {
    id: "inspirador",
    label: "Inspirador",
    hint: "Motivacional sin caer en el cliché.",
  },
  {
    id: "profesional",
    label: "Profesional",
    hint: "Cuidado y pulido, apto para una marca.",
  },
];

export function isValidTone(id: string): boolean {
  return TONES.some((t) => t.id === id);
}

/**
 * Tonos para las asistencias de IA del editor de blogs. Set propio (registro
 * editorial de un blog fotográfico), distinto de TONES (captions de Instagram).
 * Aplica a captions, excerpt y title; tags y description no lo usan.
 */
export const BLOG_TONES: Tone[] = [
  {
    id: "narrativo",
    label: "Narrativo",
    hint: "Cuenta la escena como parte del relato del viaje; hilo, ritmo, a veces en primera persona.",
  },
  {
    id: "contemplativo",
    label: "Contemplativo",
    hint: "Pausado y sensorial; se detiene en la luz, la textura, la atmósfera del momento.",
  },
  {
    id: "tecnico",
    label: "Técnico",
    hint: "La mirada del fotógrafo: composición, luz y decisión de la toma, sin jerga ni datos EXIF.",
  },
  {
    id: "cercano",
    label: "Cercano",
    hint: "Cálido y directo, como contándoselo a alguien al lado; primera persona natural.",
  },
  {
    id: "minimo",
    label: "Mínimo",
    hint: "Una sola frase corta; deja que la imagen hable, sin adornos.",
  },
];

export function isValidBlogTone(id: string): boolean {
  return BLOG_TONES.some((t) => t.id === id);
}
