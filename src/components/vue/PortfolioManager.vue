<script setup lang="ts">
// Gestor de imágenes del portafolio (javiersabando.lat). Dos vistas:
//   - browse: navegación del bucket público, con badge de qué imágenes ya
//     tienen metadata en Mongo.
//   - edit: formulario de metadata (PortfolioImageForm), con generación IA.
// Flujo de subida: subir → EXIF precargado → generar con IA → revisar →
// guardar (primer guardado con visible:false).
// Copia los patrones de FileManager.vue, pero contra /api/portfolio/* —
// bucket, permisos y backend distintos a la biblioteca privada.
import { computed, onMounted, ref } from "vue";
import PortfolioImageForm from "./PortfolioImageForm.vue";

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

interface BucketFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
  image: PortfolioImageDoc | null;
}

const prefix = ref("");
const folders = ref<string[]>([]);
const files = ref<BucketFile[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);
const suggestedCategories = ref<string[]>([]);

// Vista de edición: archivo activo + prefill (EXIF al subir, doc si existe).
const editing = ref<BucketFile | null>(null);
const editPrefill = ref<Partial<PortfolioImageDoc> | null>(null);

const breadcrumbs = computed(() => {
  const parts = prefix.value.split("/").filter(Boolean);
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/") + "/",
  }));
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(
      `/api/portfolio/browse?prefix=${encodeURIComponent(prefix.value)}`,
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    folders.value = data.folders;
    files.value = data.files;
  } catch {
    error.value =
      "No se pudo cargar el bucket del portafolio. Revisa las variables PORTFOLIO_* y la conexión.";
  } finally {
    loading.value = false;
  }
}

async function loadCategories() {
  try {
    const res = await fetch("/api/portfolio/categories");
    if (!res.ok) return;
    const data = await res.json();
    suggestedCategories.value = data.categories;
  } catch {
    // Sin sugerencias no pasa nada; el formulario sigue funcionando.
  }
}

function navigate(to: string) {
  prefix.value = to;
  load();
}

function folderName(full: string): string {
  return full.replace(/\/$/, "").split("/").pop() ?? full;
}

function openEditor(file: BucketFile) {
  editing.value = file;
  editPrefill.value = file.image;
}

function closeEditor(reload = false) {
  editing.value = null;
  editPrefill.value = null;
  if (reload) load();
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  if (selected.length === 0) return;
  busy.value = true;
  error.value = null;
  try {
    let lastUploaded: { file: BucketFile; exif: Partial<PortfolioImageDoc> } | null =
      null;

    for (const file of selected) {
      const form = new FormData();
      form.append("file", file);
      form.append("path", prefix.value.replace(/\/$/, ""));
      const res = await fetch("/api/portfolio/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(
          data.error === "too_large"
            ? `"${file.name}" supera el límite de 25MB.`
            : data.error === "unsupported_type"
              ? `"${file.name}" no es una imagen soportada (JPG, PNG, WebP).`
              : `No se pudo subir "${file.name}".`,
        );
        continue;
      }
      lastUploaded = {
        file: {
          key: data.key,
          name: data.file,
          size: data.size,
          lastModified: null,
          url: data.url,
          image: null,
        },
        exif: data.exif,
      };
    }

    await load();

    // Wizard: si se subió UNA imagen, saltar directo al formulario con el
    // EXIF precargado para generar y guardar la metadata del tirón.
    if (selected.length === 1 && lastUploaded) {
      editing.value = lastUploaded.file;
      editPrefill.value = lastUploaded.exif;
    }
  } finally {
    busy.value = false;
    input.value = "";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMounted(() => {
  load();
  loadCategories();
});
</script>

<template>
  <!-- Vista de edición -->
  <div v-if="editing">
    <button
      class="mb-4 text-sm text-neutral-600 hover:text-pink-600"
      @click="closeEditor()"
    >
      ← Volver al explorador
    </button>
    <PortfolioImageForm
      :key="editing.url"
      :image-url="editing.url"
      :storage-key="editing.key"
      :file-name="editing.name"
      :initial="editPrefill"
      :suggested-categories="suggestedCategories"
      :exists="!!editing.image"
      @saved="closeEditor(true)"
      @deleted="closeEditor(true)"
      @cancel="closeEditor()"
    />
  </div>

  <!-- Vista de navegación -->
  <div v-else>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav class="flex items-center gap-1 text-sm text-neutral-600">
        <button class="font-medium hover:text-pink-600" @click="navigate('')">
          Inicio
        </button>
        <template v-for="crumb in breadcrumbs" :key="crumb.path">
          <span>/</span>
          <button class="hover:text-pink-600" @click="navigate(crumb.path)">
            {{ crumb.name }}
          </button>
        </template>
      </nav>
      <div class="flex gap-2">
        <button
          :disabled="busy"
          class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          @click="uploadInput?.click()"
        >
          {{ busy ? "Subiendo…" : "Subir imágenes" }}
        </button>
        <input
          ref="uploadInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          class="hidden"
          @change="onUpload"
        />
      </div>
    </div>

    <p v-if="loading" class="text-neutral-500">Cargando…</p>
    <p
      v-else-if="error"
      class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </p>

    <template v-else>
      <p
        v-if="folders.length === 0 && files.length === 0"
        class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
      >
        Esta carpeta está vacía. Sube imágenes para empezar.
      </p>

      <!-- Carpetas -->
      <div
        v-if="folders.length"
        class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <button
          v-for="folder in folders"
          :key="folder"
          class="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-left text-sm font-medium hover:border-pink-400"
          @click="navigate(folder)"
        >
          <span aria-hidden="true">📁</span>
          <span class="truncate">{{ folderName(folder) }}</span>
        </button>
      </div>

      <!-- Archivos -->
      <div v-if="files.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <figure
          v-for="file in files"
          :key="file.key"
          class="group relative cursor-pointer overflow-hidden rounded-xl border border-neutral-200 bg-white hover:border-pink-400"
          @click="openEditor(file)"
        >
          <img
            :src="file.url"
            :alt="file.name"
            loading="lazy"
            class="aspect-square w-full object-cover"
          />
          <!-- Badge de estado de catalogación -->
          <span
            class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="
              file.image
                ? file.image.visible
                  ? 'bg-green-100 text-green-800'
                  : 'bg-amber-100 text-amber-800'
                : 'bg-neutral-200 text-neutral-600'
            "
          >
            {{
              file.image
                ? file.image.visible
                  ? "Visible"
                  : "Oculta"
                : "Sin metadata"
            }}
          </span>
          <figcaption class="flex items-center justify-between gap-2 p-2">
            <span class="truncate text-xs text-neutral-700">{{ file.name }}</span>
            <span class="shrink-0 text-xs text-neutral-400">
              {{ formatSize(file.size) }}
            </span>
          </figcaption>
        </figure>
      </div>
    </template>
  </div>
</template>
