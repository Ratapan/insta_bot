<script setup lang="ts">
// Gestor de imágenes del portafolio (javiersabando.lat). Dos vistas:
//   - browse: navegación del bucket público, con badge de qué imágenes ya
//     tienen metadata en Mongo.
//   - edit: formulario de metadata (PortfolioImageForm), con generación IA.
// Flujo de subida: subir → EXIF precargado → generar con IA → revisar →
// guardar (primer guardado con visible:false).
// Copia los patrones de FileManager.vue, pero contra /api/portfolio/* —
// bucket, permisos y backend distintos a la biblioteca privada.
// El wizard "Subir sesión" sube una tanda completa a blog/images/{sesión}/,
// guarda el contexto en la colección `sessions` y crea el doc de cada imagen
// con su EXIF y el campo session (visible:false, como todo insert).
import { computed, onMounted, ref, watch } from "vue";
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

// ---------- Wizard de sesión ----------

interface SessionDoc {
  session: string;
  context: string;
}

const wizardOpen = ref(false);
const sessionsList = ref<SessionDoc[]>([]);
const wizInput = ref<HTMLInputElement | null>(null);
const wizName = ref(defaultSessionName());
const wizContext = ref("");
const wizFiles = ref<File[]>([]);
const wizBusy = ref(false);
const wizDone = ref(false);
const wizProgress = ref({ done: 0, total: 0 });
const wizErrors = ref<string[]>([]);

/** Prefijo de fecha AAMMDD, el patrón de las sesiones existentes. */
function defaultSessionName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_`;
}

const wizNameValid = computed(() => /^[\w-]+$/.test(wizName.value.trim()));

async function loadSessions() {
  try {
    const res = await fetch("/api/portfolio/sessions");
    if (!res.ok) return;
    const data = await res.json();
    sessionsList.value = data.sessions;
  } catch {
    // Sin la lista, el wizard sigue sirviendo (solo pierde el autocompletado).
  }
}

// Elegir una sesión existente precarga su contexto para poder retocarlo.
watch(wizName, (name) => {
  const found = sessionsList.value.find((s) => s.session === name.trim());
  if (found) wizContext.value = found.context;
});

function openWizard() {
  wizardOpen.value = true;
  wizDone.value = false;
  wizErrors.value = [];
  wizFiles.value = [];
  loadSessions();
}

function onWizardFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  wizFiles.value = Array.from(input.files ?? []);
}

const WIZ_UPLOAD_ERRORS: Record<string, string> = {
  too_large: "supera el límite de 25MB",
  unsupported_type: "no es una imagen soportada (JPG, PNG, WebP)",
  storage_error: "no se pudo subir al bucket",
  invalid_fields: "tiene metadata no válida",
  portfolio_unavailable: "no se pudo guardar en Mongo",
};

async function uploadSession() {
  const name = wizName.value.trim();
  if (!wizNameValid.value || wizFiles.value.length === 0 || wizBusy.value) return;
  wizBusy.value = true;
  wizErrors.value = [];
  wizProgress.value = { done: 0, total: wizFiles.value.length };

  try {
    // 1. El contexto de la sesión, aunque venga vacío: crea el doc.
    const sessionRes = await fetch("/api/portfolio/sessions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: name, context: wizContext.value }),
    });
    if (!sessionRes.ok) {
      const data = await sessionRes.json();
      wizErrors.value.push(
        `No se pudo guardar la sesión: ${WIZ_UPLOAD_ERRORS[data.error] ?? data.error}.`,
      );
      return;
    }

    // 2. Las fotos, en secuencia: subir a R2 y crear el doc con EXIF+session.
    for (const file of wizFiles.value) {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("path", `blog/images/${name}`);
        const res = await fetch("/api/portfolio/upload", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          wizErrors.value.push(
            `${file.name}: ${WIZ_UPLOAD_ERRORS[data.error] ?? "falló la subida"}.`,
          );
          continue;
        }

        const docRes = await fetch("/api/portfolio/image", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: data.url,
            file: data.file,
            session: name,
            ...data.exif,
          }),
        });
        if (!docRes.ok) {
          const docData = await docRes.json();
          wizErrors.value.push(
            `${file.name}: subida, pero ${WIZ_UPLOAD_ERRORS[docData.error] ?? "sin doc en Mongo"}.`,
          );
        }
      } catch {
        wizErrors.value.push(`${file.name}: error de red.`);
      } finally {
        wizProgress.value.done += 1;
      }
    }

    wizDone.value = true;
    // Refresca el explorador apuntando a la carpeta de la sesión.
    navigate(`blog/images/${name}/`);
  } finally {
    wizBusy.value = false;
  }
}

function closeWizard() {
  if (wizBusy.value) return;
  wizardOpen.value = false;
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
          class="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500"
          @click="openWizard"
        >
          📸 Subir sesión
        </button>
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

    <!-- Wizard de sesión -->
    <div
      v-if="wizardOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeWizard"
    >
      <div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">📸 Subir sesión</h2>
          <button
            :disabled="wizBusy"
            class="text-sm text-neutral-500 hover:text-neutral-800 disabled:opacity-40"
            @click="closeWizard"
          >
            Cerrar ✕
          </button>
        </div>

        <!-- Resumen final -->
        <div v-if="wizDone" class="space-y-3">
          <p class="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            Listo: {{ wizProgress.total - wizErrors.length }} de
            {{ wizProgress.total }} fotos subidas a
            <span class="font-medium">{{ wizName.trim() }}</span> (entran
            ocultas, pendientes de revisión).
          </p>
          <ul
            v-if="wizErrors.length"
            class="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700"
          >
            <li v-for="(e, i) in wizErrors" :key="i">{{ e }}</li>
          </ul>
          <div class="flex gap-2">
            <a
              href="/app/portfolio/revisar"
              class="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500"
            >
              ⚡ Ir a revisar
            </a>
            <button
              class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
              @click="closeWizard"
            >
              Cerrar
            </button>
          </div>
        </div>

        <!-- Formulario -->
        <div v-else class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium">Sesión</label>
            <input
              v-model="wizName"
              type="text"
              list="portfolio-sessions"
              placeholder="260705_costanera"
              :disabled="wizBusy"
              class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
            <datalist id="portfolio-sessions">
              <option
                v-for="s in sessionsList"
                :key="s.session"
                :value="s.session"
              ></option>
            </datalist>
            <p
              class="mt-1 text-xs"
              :class="
                wizName.trim() && !wizNameValid
                  ? 'text-red-600'
                  : 'text-neutral-500'
              "
            >
              Carpeta bajo blog/images/ — solo letras, números, guion y guion
              bajo.
            </p>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">
              Contexto de la sesión (para la IA)
            </label>
            <textarea
              v-model="wizContext"
              rows="3"
              maxlength="2000"
              :disabled="wizBusy"
              placeholder="Dónde fue, qué se fotografió, detalles que no se ven en las fotos…"
              class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            ></textarea>
          </div>

          <div>
            <button
              :disabled="wizBusy"
              class="rounded-lg border border-dashed border-neutral-400 px-4 py-2 text-sm text-neutral-600 hover:border-pink-400 disabled:opacity-50"
              @click="wizInput?.click()"
            >
              {{
                wizFiles.length
                  ? `${wizFiles.length} foto${wizFiles.length === 1 ? "" : "s"} elegida${wizFiles.length === 1 ? "" : "s"}`
                  : "Elegir fotos…"
              }}
            </button>
            <input
              ref="wizInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              class="hidden"
              @change="onWizardFiles"
            />
          </div>

          <!-- Progreso -->
          <div v-if="wizBusy">
            <div class="mb-1 text-sm text-neutral-600">
              Subiendo… {{ wizProgress.done }}/{{ wizProgress.total }}
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-neutral-200">
              <div
                class="h-full rounded-full bg-pink-600 transition-all"
                :style="{
                  width: `${wizProgress.total ? (wizProgress.done / wizProgress.total) * 100 : 0}%`,
                }"
              ></div>
            </div>
          </div>
          <ul
            v-if="wizErrors.length"
            class="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700"
          >
            <li v-for="(e, i) in wizErrors" :key="i">{{ e }}</li>
          </ul>

          <button
            :disabled="wizBusy || !wizNameValid || wizFiles.length === 0"
            class="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="uploadSession"
          >
            {{
              wizBusy
                ? "Subiendo…"
                : `Subir ${wizFiles.length || ""} foto${wizFiles.length === 1 ? "" : "s"}`
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
