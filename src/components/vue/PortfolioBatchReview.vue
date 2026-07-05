<script setup lang="ts">
// Panel de revisión del lote de IA: propuestas lado a lado con lo actual,
// aceptar/rechazar POR CAMPO y por categoría. Las categorías fuera del
// vocabulario llegan como sugerencias (badge "nueva") desmarcadas por defecto:
// aprobarlas las guarda en la imagen Y las añade al vocabulario (tags).
// El componente solo decide; aplicar los PATCH es cosa del padre (evento apply).
import { computed, reactive, watch } from "vue";

interface BatchProposal {
  url: string;
  file: string;
  caption: string;
  caption_en: string;
  footer: string;
  footer_en: string;
  categories: string[];
  unknownCategories: string[];
}

interface CurrentFields {
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
  categories: string[];
}

type TextField = "caption" | "caption_en" | "footer" | "footer_en";
const TEXT_FIELDS: { id: TextField; label: string }[] = [
  { id: "caption", label: "Caption (es)" },
  { id: "caption_en", label: "Caption (en)" },
  { id: "footer", label: "Footer (es)" },
  { id: "footer_en", label: "Footer (en)" },
];

const props = defineProps<{
  proposals: BatchProposal[];
  /** Valores actuales de cada imagen, para comparar lado a lado. */
  currentByUrl: Record<string, CurrentFields>;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  skipped: string[];
  error: string | null;
  /** True mientras el padre aplica los PATCH. */
  applying: boolean;
}>();

const emit = defineEmits<{
  apply: [
    payload: {
      items: { url: string; fields: Record<string, unknown> }[];
      newCategories: string[];
    },
  ];
  close: [];
}>();

interface Decision {
  caption: boolean;
  caption_en: boolean;
  footer: boolean;
  footer_en: boolean;
  cats: Record<string, boolean>;
}

const decisions = reactive(new Map<string, Decision>());

// Inicializa la decisión de cada propuesta según va llegando: campos de texto
// marcados si aportan algo; categorías conocidas marcadas, nuevas desmarcadas.
watch(
  () => props.proposals.length,
  () => {
    for (const p of props.proposals) {
      if (decisions.has(p.url)) continue;
      const current = props.currentByUrl[p.url];
      const cats: Record<string, boolean> = {};
      for (const c of p.categories) cats[c] = !p.unknownCategories.includes(c);
      decisions.set(p.url, {
        caption: !!p.caption && p.caption !== current?.caption,
        caption_en: !!p.caption_en && p.caption_en !== current?.caption_en,
        footer: !!p.footer && p.footer !== current?.footer,
        footer_en: !!p.footer_en && p.footer_en !== current?.footer_en,
        cats,
      });
    }
  },
  { immediate: true },
);

function setAll(value: boolean) {
  for (const p of props.proposals) {
    const d = decisions.get(p.url);
    if (!d) continue;
    for (const f of TEXT_FIELDS) d[f.id] = value;
    for (const c of Object.keys(d.cats)) d.cats[c] = value;
  }
}

const acceptedImages = computed(() => {
  let n = 0;
  for (const p of props.proposals) {
    const d = decisions.get(p.url);
    if (!d) continue;
    const anyText = TEXT_FIELDS.some((f) => d[f.id]);
    const anyCat = Object.values(d.cats).some(Boolean);
    if (anyText || anyCat) n += 1;
  }
  return n;
});

function buildApply() {
  const items: { url: string; fields: Record<string, unknown> }[] = [];
  const newCategories = new Set<string>();

  for (const p of props.proposals) {
    const d = decisions.get(p.url);
    if (!d) continue;
    const fields: Record<string, unknown> = {};
    for (const f of TEXT_FIELDS) {
      if (d[f.id] && p[f.id]) fields[f.id] = p[f.id];
    }
    const acceptedCats = p.categories.filter((c) => d.cats[c]);
    if (acceptedCats.length > 0) {
      fields.categories = acceptedCats;
      for (const c of acceptedCats) {
        if (p.unknownCategories.includes(c)) newCategories.add(c);
      }
    }
    if (Object.keys(fields).length > 0) items.push({ url: p.url, fields });
  }

  emit("apply", { items, newCategories: [...newCategories] });
}

const ERROR_MESSAGES: Record<string, string> = {
  claude_unavailable:
    "Claude dejó de responder a mitad del lote. Puedes aplicar lo que alcanzó a proponer.",
  claude_parse:
    "Claude devolvió una respuesta inválida a mitad del lote. Puedes aplicar lo que alcanzó a proponer.",
  unknown: "El lote falló a mitad de camino. Puedes aplicar lo parcial.",
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div class="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
      <!-- Cabecera -->
      <div class="border-b border-neutral-200 p-4">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">✨ Propuestas del lote</h2>
          <span class="text-sm text-neutral-500">
            {{ done }}/{{ total }}
            {{ status === "running" ? "· generando…" : "" }}
          </span>
        </div>
        <div
          v-if="status === 'running'"
          class="mt-2 h-1 overflow-hidden rounded-full bg-neutral-200"
        >
          <div
            class="h-full rounded-full bg-pink-600 transition-all"
            :style="{ width: `${total ? (done / total) * 100 : 0}%` }"
          ></div>
        </div>
        <p v-if="status === 'running'" class="mt-1 text-xs text-neutral-500">
          Una tanda de 6-8 fotos por vez, en una sola conversación. Puede tardar
          unos minutos; las propuestas van apareciendo abajo.
        </p>
        <p
          v-if="status === 'error'"
          class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {{ ERROR_MESSAGES[error ?? "unknown"] ?? ERROR_MESSAGES.unknown }}
        </p>
        <p
          v-if="skipped.length"
          class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          Quedaron fuera (no se pudieron leer): {{ skipped.join(", ") }}
        </p>
      </div>

      <!-- Propuestas -->
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <p
          v-if="proposals.length === 0"
          class="py-8 text-center text-sm text-neutral-500"
        >
          {{ status === "running" ? "Esperando la primera tanda…" : "No hay propuestas." }}
        </p>

        <div
          v-for="p in proposals"
          :key="p.url"
          class="rounded-xl border border-neutral-200 p-3"
        >
          <div class="flex gap-3">
            <img
              :src="p.url"
              :alt="p.file"
              loading="lazy"
              class="h-20 w-20 shrink-0 rounded-lg object-cover"
            />
            <div class="min-w-0 flex-1">
              <p class="mb-2 truncate text-xs font-medium text-neutral-500">
                {{ p.file }}
              </p>
              <div class="grid gap-2 sm:grid-cols-2">
                <label
                  v-for="f in TEXT_FIELDS"
                  :key="f.id"
                  class="flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-xs"
                  :class="
                    decisions.get(p.url)?.[f.id]
                      ? 'border-pink-300 bg-pink-50/50'
                      : 'border-neutral-200 opacity-70'
                  "
                >
                  <input
                    type="checkbox"
                    class="mt-0.5 accent-pink-600"
                    :checked="decisions.get(p.url)?.[f.id]"
                    @change="
                      decisions.get(p.url)![f.id] = (
                        $event.target as HTMLInputElement
                      ).checked
                    "
                  />
                  <span class="min-w-0">
                    <span class="mb-0.5 block font-medium text-neutral-500">
                      {{ f.label }}
                    </span>
                    <span class="block text-neutral-800">{{ p[f.id] }}</span>
                    <span
                      v-if="currentByUrl[p.url]?.[f.id] && currentByUrl[p.url]?.[f.id] !== p[f.id]"
                      class="mt-0.5 block text-neutral-400 line-through"
                    >
                      {{ currentByUrl[p.url]?.[f.id] }}
                    </span>
                  </span>
                </label>
              </div>

              <!-- Categorías: chips con toggle; las nuevas piden aprobación -->
              <div class="mt-2 flex flex-wrap items-center gap-1">
                <button
                  v-for="c in p.categories"
                  :key="c"
                  class="rounded-full border px-2 py-0.5 text-xs"
                  :class="
                    decisions.get(p.url)?.cats[c]
                      ? p.unknownCategories.includes(c)
                        ? 'border-amber-500 bg-amber-100 text-amber-800'
                        : 'border-pink-500 bg-pink-50 text-pink-700'
                      : 'border-neutral-300 text-neutral-400'
                  "
                  @click="decisions.get(p.url)!.cats[c] = !decisions.get(p.url)!.cats[c]"
                >
                  {{ c }}
                  <span
                    v-if="p.unknownCategories.includes(c)"
                    class="font-semibold"
                  >
                    · nueva
                  </span>
                </button>
                <span class="text-xs text-neutral-400">
                  — la primera aceptada será la principal
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pie de acciones -->
      <div class="flex flex-wrap items-center gap-2 border-t border-neutral-200 p-4">
        <button
          :disabled="applying || proposals.length === 0"
          class="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-40"
          @click="setAll(true)"
        >
          Aceptar todo
        </button>
        <button
          :disabled="applying || proposals.length === 0"
          class="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-40"
          @click="setAll(false)"
        >
          Nada
        </button>
        <div class="ml-auto flex gap-2">
          <button
            :disabled="applying"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="emit('close')"
          >
            Descartar
          </button>
          <button
            :disabled="applying || status === 'running' || acceptedImages === 0"
            class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="buildApply"
          >
            {{
              applying
                ? "Aplicando…"
                : `Aplicar a ${acceptedImages} imagen${acceptedImages === 1 ? "" : "es"}`
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
