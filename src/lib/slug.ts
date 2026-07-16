// Generación y unicidad de slugs para los posts del portafolio (colección
// `blogs`). El slug es la URL pública del post, así que solo [a-z0-9-] (mismo
// match que el modelo Mongoose Blog.ts).

const DIACRITICS = /[̀-ͯ]/g;

/**
 * "Diseño ágil" → "diseno-agil". Normaliza NFD para separar los diacríticos y
 * los elimina (a diferencia del hook de Mongoose, que los DROPEA sin separar y
 * convertiría "ágil" en "gil").
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Devuelve un slug único a partir de `base`. Si el slugificado ya existe,
 * prueba sufijos incrementales `-2`, `-3`, … `taken` consulta la colección.
 */
export async function ensureUniqueSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || "post";
  if (!(await taken(root))) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  // Fallback improbable: sufijo temporal para no bloquear el guardado.
  return `${root}-${Date.now().toString(36)}`;
}
