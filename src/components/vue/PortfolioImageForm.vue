<script setup lang="ts">
// Editor de metadata de una imagen del portafolio: campos bilingües, técnica
// (EXIF), categorías y flags de publicación. El botón "Generar con IA" pide a
// Claude un borrador (caption/footer es+en, categorías) que el dueño revisa.
import { computed, reactive, ref } from "vue";

interface PortfolioImageDoc {
  url: string;
  file: string;
  categories: string[];
  category?: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
  focal?: string;
  apertura?: number;
  iso?: number;
  velocidad?: string;
  camera?: string;
  lens?: string;
  stars: number;
  portfolio: boolean;
  visible: boolean;
}

const props = defineProps<{
  /** URL pública de la imagen (preview + clave del doc en Mongo). */
  imageUrl: string;
  /** Key del objeto en el bucket (para el endpoint de generación). */
  storageKey: string;
  /** Nombre de archivo. */
  fileName: string;
  /** Doc existente o prefill (p. ej. EXIF recién extraído al subir). */
  initial?: Partial<PortfolioImageDoc> | null;
  /** Categorías ya usadas en el portafolio, como sugerencias. */
  suggestedCategories: string[];
  /** True si ya existe doc en Mongo (cambia el texto del botón de guardar). */
  exists: boolean;
}>();

const emit = defineEmits<{
  saved: [image: PortfolioImageDoc];
  deleted: [];
  cancel: [];
}>();

const form = reactive({
  caption: props.initial?.caption ?? "",
  caption_en: props.initial?.caption_en ?? "",
  footer: props.initial?.footer ?? "",
  footer_en: props.initial?.footer_en ?? "",
  categoriesText: (props.initial?.categories ?? []).join(", "),
  focal: props.initial?.focal ?? "",
  apertura: props.initial?.apertura?.toString() ?? "",
  iso: props.initial?.iso?.toString() ?? "",
  velocidad: props.initial?.velocidad ?? "",
  camera: props.initial?.camera ?? "",
  lens: props.initial?.lens ?? "",
  stars: props.initial?.stars ?? 0,
  portfolio: props.initial?.portfolio ?? false,
  visible: props.initial?.visible ?? false,
});

const aiContext = ref("");
const generating = ref(false);
const saving = ref(false);
const deleting = ref(false);
const error = ref<string | null>(null);

const ERROR_MESSAGES: Record<string, string> = {
  claude_unavailable:
    "Claude está saturado ahora mismo. Espera unos segundos y reinténtalo.",
  claude_parse: "La respuesta de Claude no fue válida. Reinténtalo.",
  image_fetch_failed: "No pudimos leer la imagen desde el bucket.",
  rate_limited:
    "Has alcanzado el límite de generaciones por hora. Espera un poco antes de seguir.",
  invalid_fields: "Hay campos con valores no válidos.",
  portfolio_unavailable:
    "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

const categories = computed(() =>
  form.categoriesText
    .split(",")
    .map((c) => c.toLowerCase().trim())
    .filter(Boolean),
);

function addSuggested(cat: string) {
  if (categories.value.includes(cat)) return;
  form.categoriesText = [...categories.value, cat].join(", ");
}

async function generate() {
  generating.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/portfolio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: props.storageKey, context: aiContext.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = messageFor(data.error);
      return;
    }
    const m = data.metadata;
    form.caption = m.caption;
    form.caption_en = m.caption_en;
    form.footer = m.footer;
    form.footer_en = m.footer_en;
    // La categoría principal es categories[0]; el generador ya la pone primera.
    form.categoriesText = m.categories.join(", ");
  } catch {
    error.value = messageFor("unknown");
  } finally {
    generating.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/portfolio/image", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: props.imageUrl,
        file: props.fileName,
        caption: form.caption,
        caption_en: form.caption_en,
        footer: form.footer,
        footer_en: form.footer_en,
        // `category` no se envía: el servidor la deriva de categories[0].
        categories: categories.value,
        focal: form.focal,
        apertura: form.apertura === "" ? undefined : Number(form.apertura),
        iso: form.iso === "" ? undefined : Number(form.iso),
        velocidad: form.velocidad,
        camera: form.camera,
        lens: form.lens,
        stars: form.stars,
        portfolio: form.portfolio,
        visible: form.visible,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = messageFor(data.error);
      return;
    }
    emit("saved", data.image);
  } catch {
    error.value = messageFor("unknown");
  } finally {
    saving.value = false;
  }
}

async function removeDoc() {
  const alsoObject = confirm(
    "¿Borrar también el archivo del bucket?\n\nAceptar: borra metadata Y archivo.\nCancelar: solo pregunta por la metadata.",
  );
  if (!alsoObject && !confirm("¿Borrar solo la metadata (el doc en Mongo)?")) {
    return;
  }
  deleting.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/portfolio/image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: props.imageUrl, deleteObject: alsoObject }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = messageFor(data.error);
      return;
    }
    emit("deleted");
  } catch {
    error.value = messageFor("unknown");
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[2fr_3fr]">
    <!-- Vista previa -->
    <div>
      <img
        :src="imageUrl"
        :alt="fileName"
        class="w-full rounded-xl border border-neutral-200 bg-white object-contain"
      />
      <p class="mt-2 truncate text-xs text-neutral-500">{{ fileName }}</p>

      <!-- Generación con IA -->
      <div class="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <label class="mb-1 block text-sm font-medium">
          Contexto para la IA (opcional)
        </label>
        <textarea
          v-model="aiContext"
          rows="2"
          maxlength="2000"
          placeholder="Dónde se tomó, qué es, detalles que no se ven…"
          class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
        ></textarea>
        <button
          :disabled="generating || saving"
          class="mt-2 w-full rounded-lg bg-pink-600 px-3 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
          @click="generate"
        >
          {{ generating ? "Generando…" : "✨ Generar con IA" }}
        </button>
      </div>
    </div>

    <!-- Formulario -->
    <div class="space-y-4">
      <p
        v-if="error"
        class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ error }}
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-sm font-medium">Caption (es)</label>
          <textarea
            v-model="form.caption"
            rows="2"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Caption (en)</label>
          <textarea
            v-model="form.caption_en"
            rows="2"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Footer (es)</label>
          <textarea
            v-model="form.footer"
            rows="3"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Footer (en)</label>
          <textarea
            v-model="form.footer_en"
            rows="3"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>
      </div>

      <!-- Categorías -->
      <div>
        <label class="mb-1 block text-sm font-medium">
          Categorías (separadas por coma)
        </label>
        <input
          v-model="form.categoriesText"
          type="text"
          placeholder="animales, granjas, aves"
          class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
        />
        <p class="mt-1 text-xs text-neutral-500">
          La primera de la lista es la categoría principal{{
            categories.length ? `: ${categories[0]}` : ""
          }}.
        </p>
        <div v-if="suggestedCategories.length" class="mt-2 flex flex-wrap gap-1">
          <button
            v-for="cat in suggestedCategories"
            :key="cat"
            type="button"
            class="rounded-full border px-2 py-0.5 text-xs"
            :class="
              categories.includes(cat)
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-neutral-300 text-neutral-600 hover:border-pink-400'
            "
            @click="addSuggested(cat)"
          >
            {{ cat }}
          </button>
        </div>
      </div>

      <!-- Técnica (EXIF) -->
      <details class="rounded-xl border border-neutral-200 bg-white p-4">
        <summary class="cursor-pointer text-sm font-medium">
          Datos técnicos (EXIF)
        </summary>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label class="mb-1 block text-xs text-neutral-600">Focal</label>
            <input
              v-model="form.focal"
              type="text"
              placeholder="50 mm"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-neutral-600">Apertura</label>
            <input
              v-model="form.apertura"
              type="number"
              step="0.1"
              placeholder="2.8"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-neutral-600">ISO</label>
            <input
              v-model="form.iso"
              type="number"
              placeholder="400"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-neutral-600">Velocidad</label>
            <input
              v-model="form.velocidad"
              type="text"
              placeholder="1/250"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-neutral-600">Cámara</label>
            <input
              v-model="form.camera"
              type="text"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-neutral-600">Objetivo</label>
            <input
              v-model="form.lens"
              type="text"
              class="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </details>

      <!-- Publicación -->
      <div class="flex flex-wrap items-center gap-5 rounded-xl border border-neutral-200 bg-white p-4">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.portfolio" type="checkbox" class="accent-pink-600" />
          En portafolio
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.visible" type="checkbox" class="accent-pink-600" />
          Visible en el sitio
        </label>
        <label class="flex items-center gap-2 text-sm">
          Estrellas
          <select
            v-model.number="form.stars"
            class="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
          >
            <option v-for="n in [0, 1, 2, 3, 4, 5]" :key="n" :value="n">
              {{ n }}
            </option>
          </select>
        </label>
      </div>

      <!-- Acciones -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          :disabled="saving || generating"
          class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          @click="save"
        >
          {{ saving ? "Guardando…" : exists ? "Guardar cambios" : "Guardar metadata" }}
        </button>
        <button
          :disabled="saving || generating"
          class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
          @click="emit('cancel')"
        >
          Volver
        </button>
        <button
          v-if="exists"
          :disabled="deleting"
          class="ml-auto rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          @click="removeDoc"
        >
          {{ deleting ? "Borrando…" : "Borrar" }}
        </button>
      </div>
    </div>
  </div>
</template>
