<script setup lang="ts">
// Selector de imágenes del portafolio (modal), compartido por el editor de
// posts para mainImage y los bloques image/slide. Navega el bucket público vía
// /api/portfolio/browse (mismo cruce R2+Mongo que el gestor): permite elegir una
// imagen existente —catalogada o huérfana—, subir una nueva a la carpeta de
// sesión que estés navegando, y "Catalogar" una huérfana (image:null) para
// crearle el doc con su EXIF. Emite solo la URL pública; el post referencia esa
// url y el sitio enriquece el resto desde `images`.
import { computed, ref, watch } from "vue";

interface ImageDoc {
  visible: boolean;
}
interface BucketFile {
  key: string;
  name: string;
  size: number;
  url: string;
  image: ImageDoc | null;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "select", url: string): void; (e: "close"): void }>();

const prefix = ref("blog/images/");
const folders = ref<string[]>([]);
const files = ref<BucketFile[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);
const catalogingUrl = ref<string | null>(null);
const everOpened = ref(false);

const breadcrumbs = computed(() => {
  const parts = prefix.value.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") + "/" }));
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`/api/portfolio/browse?prefix=${encodeURIComponent(prefix.value)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    folders.value = data.folders;
    files.value = data.files;
  } catch {
    error.value = "No se pudo cargar el bucket. Revisa las variables PORTFOLIO_* y la conexión.";
  } finally {
    loading.value = false;
  }
}

// Carga perezosa: solo la primera vez que se abre (no en cada montaje del editor).
watch(
  () => props.open,
  (open) => {
    if (open && !everOpened.value) {
      everOpened.value = true;
      load();
    }
  },
);

function navigate(to: string) {
  prefix.value = to;
  load();
}
function folderName(full: string): string {
  return full.replace(/\/$/, "").split("/").pop() ?? full;
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  if (selected.length === 0) return;
  busy.value = true;
  error.value = null;
  try {
    const form = new FormData();
    form.append("file", selected[0]);
    form.append("path", prefix.value.replace(/\/$/, ""));
    const res = await fetch("/api/portfolio/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      error.value =
        data.error === "too_large"
          ? "La imagen supera el límite de 25MB."
          : data.error === "unsupported_type"
            ? "Formato no soportado (JPG, PNG, WebP)."
            : "No se pudo subir la imagen.";
      return;
    }
    await load();
    emit("select", data.url); // auto-selecciona la recién subida
  } finally {
    busy.value = false;
    input.value = "";
  }
}

async function catalog(file: BucketFile) {
  catalogingUrl.value = file.url;
  error.value = null;
  try {
    const res = await fetch("/api/portfolio/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: file.url }),
    });
    if (!res.ok) {
      const data = await res.json();
      error.value =
        data.error === "exif_fetch_failed"
          ? "No se pudo descargar la imagen para leer su EXIF."
          : "No se pudo catalogar la imagen.";
      return;
    }
    await load(); // ahora aparece con metadata (Oculta), editable en la cola de revisión
  } finally {
    catalogingUrl.value = null;
  }
}
</script>

<template>
  <div
    v-if="props.open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    @click.self="emit('close')"
  >
    <div class="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-5 shadow-xl">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold">Elegir imagen</h2>
        <button class="text-sm text-neutral-500 hover:text-neutral-800" @click="emit('close')">
          Cerrar ✕
        </button>
      </div>

      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav class="flex flex-wrap items-center gap-1 text-sm text-neutral-600">
          <button class="font-medium hover:text-pink-600" @click="navigate('')">Inicio</button>
          <template v-for="c in breadcrumbs" :key="c.path">
            <span>/</span>
            <button class="hover:text-pink-600" @click="navigate(c.path)">{{ c.name }}</button>
          </template>
        </nav>
        <button
          :disabled="busy"
          class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          @click="uploadInput?.click()"
        >
          {{ busy ? "Subiendo…" : "Subir aquí" }}
        </button>
        <input
          ref="uploadInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          @change="onUpload"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <p v-if="loading" class="text-neutral-500">Cargando…</p>
        <p v-else-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ error }}
        </p>
        <template v-else>
          <div v-if="folders.length" class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="f in folders"
              :key="f"
              class="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 text-left text-sm hover:border-pink-400"
              @click="navigate(f)"
            >
              <span aria-hidden="true">📁</span>
              <span class="truncate">{{ folderName(f) }}</span>
            </button>
          </div>

          <div v-if="files.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <figure
              v-for="file in files"
              :key="file.key"
              class="relative overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <img
                :src="file.url"
                :alt="file.name"
                loading="lazy"
                class="aspect-square w-full cursor-pointer object-cover hover:opacity-90"
                @click="emit('select', file.url)"
              />
              <span
                class="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                :class="
                  file.image
                    ? file.image.visible
                      ? 'bg-green-100 text-green-800'
                      : 'bg-amber-100 text-amber-800'
                    : 'bg-neutral-200 text-neutral-600'
                "
              >
                {{ file.image ? (file.image.visible ? "Visible" : "Oculta") : "Sin metadata" }}
              </span>
              <div class="flex items-center justify-between gap-1 p-1">
                <button
                  class="truncate text-[11px] font-medium text-pink-600 hover:underline"
                  @click="emit('select', file.url)"
                >
                  Elegir
                </button>
                <!-- "Catalogar" solo en huérfanas (image:null). Es opcional: elegir
                     la imagen no requiere catalogarla. -->
                <button
                  v-if="!file.image"
                  :disabled="catalogingUrl === file.url"
                  class="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
                  @click="catalog(file)"
                >
                  {{ catalogingUrl === file.url ? "…" : "Catalogar" }}
                </button>
              </div>
            </figure>
          </div>

          <p
            v-if="!folders.length && !files.length"
            class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500"
          >
            Carpeta vacía. Navega a una sesión o sube una imagen aquí.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
