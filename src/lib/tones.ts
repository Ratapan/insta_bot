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
