<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { TONES } from "../../lib/tones";
import FileManager from "./FileManager.vue";

// --- Feed publicado (fijo) ---
interface IgMediaChild {
  id: string;
  media_type: "IMAGE" | "VIDEO";
  media_url: string;
  thumbnail_url?: string;
}
interface IgMedia {
  id: string;
  caption: string | null;
  media_url: string;
  thumbnail_url?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  timestamp: string;
  permalink: string;
  children?: IgMediaChild[];
}

// --- Huecos planeados (borradores + programados) ---
interface PlanTile {
  id: string;
  storageKey: string;
  coverUrl: string | null;
  imageCount: number;
  caption: string;
  status: "draft" | "pending" | "failed";
  scheduledAt: string | null;
  position: number;
}

const published = ref<IgMedia[]>([]);
const tiles = ref<PlanTile[]>([]);
const state = ref<
  "loading" | "ready" | "not_connected" | "reconnect" | "error"
>("loading");

const showPicker = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const error = ref<string | null>(null);

const ERROR_MESSAGES: Record<string, string> = {
  not_connected: "Conecta tu cuenta de Instagram en Ajustes antes de programar.",
  reconnect:
    "Tu acceso a Instagram caducó. Ve a Ajustes y vuelve a conectar tu cuenta.",
  claude_unavailable:
    "Claude está saturado ahora mismo. Espera unos segundos y reinténtalo.",
  claude_parse: "La respuesta de Claude no fue válida. Reinténtalo.",
  image_fetch_failed: "No pudimos leer la imagen desde la biblioteca.",
  image_too_large: "La imagen supera el límite de 5MB para generar captions.",
  unsupported_image: "Ese archivo no es una imagen soportada.",
  caption_too_long: "El caption supera los 2.200 caracteres de Instagram.",
  schedule_in_past: "La fecha de programación debe estar en el futuro.",
  no_images: "Añade una imagen.",
  not_schedulable: "Este hueco ya no se puede programar.",
};
function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

async function load() {
  state.value = "loading";
  try {
    const [mediaRes, planRes] = await Promise.all([
      fetch("/api/instagram/media"),
      fetch("/api/feed/plan"),
    ]);
    const mediaData = await mediaRes.json();
    if (!mediaRes.ok) {
      state.value =
        mediaData.error === "not_connected"
          ? "not_connected"
          : mediaData.error === "reconnect"
            ? "reconnect"
            : "error";
      return;
    }
    published.value = mediaData.media;
    if (planRes.ok) tiles.value = (await planRes.json()).tiles;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

// --- Previsualización del feed publicado ---
function childPreview(child: IgMediaChild): string {
  return child.media_type === "VIDEO" && child.thumbnail_url
    ? child.thumbnail_url
    : child.media_url;
}
function previewUrl(item: IgMedia): string {
  if (item.media_type === "VIDEO" && item.thumbnail_url) return item.thumbnail_url;
  if (item.media_url) return item.media_url;
  const first = item.children?.[0];
  return first ? childPreview(first) : "";
}

// --- Reordenar con arrastrar y soltar ---
const dragIndex = ref<number | null>(null);

function onTileDragStart(index: number, e: DragEvent) {
  dragIndex.value = index;
  e.dataTransfer?.setData("application/x-plan-tile", String(index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onTileDragEnd() {
  dragIndex.value = null;
}
async function onTileDrop(index: number) {
  const from = dragIndex.value;
  dragIndex.value = null;
  if (from === null || from === index) return;
  const arr = [...tiles.value];
  const [moved] = arr.splice(from, 1);
  arr.splice(index, 0, moved);
  tiles.value = arr; // optimista
  try {
    await fetch("/api/feed/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", order: arr.map((t) => t.id) }),
    });
  } catch {
    await load(); // si falla, recargamos el orden real
  }
}

// --- Añadir imágenes (subida directa o soltar archivos) ---
async function uploadFile(file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("path", "subidas");
  const res = await fetch("/api/storage/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) {
    error.value =
      data.error === "too_large"
        ? `"${file.name}" supera el límite de 8MB.`
        : data.error === "unsupported_type"
          ? `"${file.name}" no es una imagen soportada (JPG, PNG, GIF, WebP).`
          : "No se pudo subir la imagen. ¿Está configurado R2?";
    return null;
  }
  return data.key as string;
}

async function addDraft(storageKey: string) {
  const res = await fetch("/api/feed/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", storageKey }),
  });
  const data = await res.json();
  if (res.ok) tiles.value.push(data.tile);
  else error.value = messageFor(data.error);
}

async function addFiles(files: File[]) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) return;
  uploading.value = true;
  error.value = null;
  try {
    for (const file of images) {
      const key = await uploadFile(file);
      if (key) await addDraft(key);
    }
  } finally {
    uploading.value = false;
  }
}

async function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  await addFiles(Array.from(input.files ?? []));
  input.value = "";
}

function onPick(file: { key: string }) {
  void addDraft(file.key);
}

// Soltar archivos del escritorio sobre el grid.
function onGridDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
}
async function onGridDrop(e: DragEvent) {
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length === 0) return; // un drag interno de reordenar
  e.preventDefault();
  await addFiles(files);
}

async function removeTile(tile: PlanTile) {
  const msg =
    tile.status === "draft"
      ? "¿Quitar este borrador del feed?"
      : "¿Cancelar esta publicación programada?";
  if (!confirm(msg)) return;
  const res = await fetch("/api/feed/plan", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: tile.id }),
  });
  if (res.ok) tiles.value = tiles.value.filter((t) => t.id !== tile.id);
}

// --- Modal de programación ---
const scheduleTarget = ref<PlanTile | null>(null);
const caption = ref("");
const tone = ref(TONES[0].id);
const scheduledAt = ref("");
const generating = ref(false);
const submitting = ref(false);
const modalError = ref<string | null>(null);

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
const minSchedule = computed(() => toLocalInput(new Date()));

function openSchedule(tile: PlanTile) {
  scheduleTarget.value = tile;
  caption.value = tile.caption;
  tone.value = TONES[0].id;
  scheduledAt.value = "";
  modalError.value = null;
}
function closeSchedule() {
  scheduleTarget.value = null;
}

async function generateCaption() {
  if (!scheduleTarget.value) return;
  generating.value = true;
  modalError.value = null;
  try {
    const res = await fetch("/api/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "library",
        storageKey: scheduleTarget.value.storageKey,
        context: "",
        tone: tone.value,
        withHashtags: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      modalError.value = messageFor(data.error);
      return;
    }
    caption.value = data.options[0].caption;
  } catch {
    modalError.value = "No se pudo conectar con el servidor.";
  } finally {
    generating.value = false;
  }
}

async function submitSchedule() {
  if (!scheduleTarget.value || !caption.value.trim() || !scheduledAt.value) return;
  submitting.value = true;
  modalError.value = null;
  try {
    const res = await fetch("/api/feed/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "schedule",
        id: scheduleTarget.value.id,
        caption: caption.value,
        scheduledAt: new Date(scheduledAt.value).toISOString(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      modalError.value = messageFor(data.error);
      return;
    }
    closeSchedule();
    await load();
  } catch {
    modalError.value = "No se pudo conectar con el servidor.";
  } finally {
    submitting.value = false;
  }
}

const STATUS_LABEL: Record<PlanTile["status"], string> = {
  draft: "Borrador",
  pending: "Programado",
  failed: "Falló",
};
const STATUS_CLASS: Record<PlanTile["status"], string> = {
  draft: "bg-neutral-800/70 text-white",
  pending: "bg-blue-600/80 text-white",
  failed: "bg-red-600/80 text-white",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(load);
</script>

<template>
  <div>
    <p v-if="state === 'loading'" class="text-neutral-500">Cargando tu feed…</p>

    <div
      v-else-if="state === 'not_connected'"
      class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center"
    >
      <p class="text-neutral-600">
        Aún no has conectado tu cuenta de Instagram.
      </p>
      <a
        href="/app/settings"
        class="mt-3 inline-block rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500"
      >
        Ir a Ajustes
      </a>
    </div>

    <div
      v-else-if="state === 'reconnect'"
      class="rounded-xl bg-amber-50 p-6 text-center"
    >
      <p class="text-amber-800">
        Tu acceso a Instagram caducó. Vuelve a conectar tu cuenta.
      </p>
      <a
        href="/app/settings"
        class="mt-3 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
      >
        Reconectar
      </a>
    </div>

    <p
      v-else-if="state === 'error'"
      class="rounded-lg bg-red-50 px-4 py-3 text-red-700"
    >
      No pudimos cargar tu feed. Recarga la página para reintentar.
    </p>

    <template v-else>
      <!-- Acciones -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <button
          :disabled="uploading"
          class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          @click="fileInput?.click()"
        >
          {{ uploading ? "Subiendo…" : "Subir imágenes" }}
        </button>
        <button
          class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
          @click="showPicker = true"
        >
          Añadir de la biblioteca
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          class="hidden"
          @change="onFileInput"
        />
        <span class="text-xs text-neutral-500">
          Arrastra las fotos para ordenarlas; suéltalas desde tu equipo sobre el
          grid para añadirlas.
        </span>
      </div>

      <p
        v-if="error"
        class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ error }}
      </p>

      <!-- Grid del feed -->
      <div
        class="rounded-2xl border border-neutral-200 bg-white p-2"
        @dragover="onGridDragOver"
        @drop="onGridDrop"
      >
        <div class="grid grid-cols-3 gap-1 sm:gap-2">
          <!-- Huecos planeados (arrastrables) -->
          <div
            v-for="(tile, index) in tiles"
            :key="tile.id"
            draggable="true"
            class="group relative aspect-square cursor-grab overflow-hidden rounded-md bg-neutral-100 active:cursor-grabbing"
            :class="dragIndex === index ? 'opacity-40 ring-2 ring-pink-400' : ''"
            @dragstart="onTileDragStart(index, $event)"
            @dragend="onTileDragEnd"
            @dragover.prevent
            @drop.stop="onTileDrop(index)"
          >
            <img
              v-if="tile.coverUrl"
              :src="tile.coverUrl"
              alt=""
              class="size-full object-cover"
            />
            <div
              v-else
              class="flex size-full items-center justify-center text-xs text-neutral-400"
            >
              sin imagen
            </div>

            <!-- Estado -->
            <span
              class="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              :class="STATUS_CLASS[tile.status]"
            >
              {{ STATUS_LABEL[tile.status] }}
            </span>
            <span
              v-if="tile.imageCount > 1"
              class="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white"
            >
              {{ tile.imageCount }}
            </span>
            <span
              v-if="tile.scheduledAt"
              class="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10px] text-white"
            >
              {{ formatDateTime(tile.scheduledAt) }}
            </span>

            <!-- Acciones al pasar el ratón -->
            <div
              class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/45 opacity-0 transition group-hover:opacity-100"
            >
              <button
                class="rounded-md bg-white/95 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white"
                @click="openSchedule(tile)"
              >
                {{ tile.status === "draft" ? "Programar" : "Reprogramar" }}
              </button>
              <button
                class="rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-white"
                @click="removeTile(tile)"
              >
                {{ tile.status === "draft" ? "Quitar" : "Cancelar" }}
              </button>
            </div>
          </div>

          <!-- Feed publicado (fijo), a continuación de los huecos planeados -->
          <!-- sin separación, para previsualizar el feed real tal cual quedará -->

          <div
            v-for="item in published"
            :key="item.id"
            class="relative aspect-square overflow-hidden rounded-md bg-neutral-100"
          >
            <img
              :src="previewUrl(item)"
              alt=""
              loading="lazy"
              class="size-full object-cover"
            />
            <span
              class="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"
              aria-label="Publicada (fija)"
            >
              <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
            <span
              v-if="item.media_type === 'CAROUSEL_ALBUM' && item.children?.length"
              class="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white"
            >
              {{ item.children.length }}
            </span>
          </div>
        </div>

        <p
          v-if="!tiles.length && !published.length"
          class="p-6 text-center text-sm text-neutral-500"
        >
          Tu feed está vacío. Sube o añade imágenes para empezar a planear.
        </p>
      </div>
    </template>

    <!-- Selector de biblioteca -->
    <div
      v-if="showPicker"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      @click.self="showPicker = false"
    >
      <div
        class="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-neutral-50 p-5 sm:rounded-2xl"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold">Añade imágenes al feed</h2>
          <button
            class="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500"
            @click="showPicker = false"
          >
            Hecho
          </button>
        </div>
        <FileManager mode="pick" @select="onPick" />
      </div>
    </div>

    <!-- Modal de programación -->
    <div
      v-if="scheduleTarget"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      @click.self="closeSchedule"
    >
      <div
        class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-bold">Programar publicación</h2>
          <button
            class="text-sm text-neutral-500 hover:text-neutral-900"
            @click="closeSchedule"
          >
            Cerrar
          </button>
        </div>

        <div class="mb-4 flex gap-3">
          <img
            v-if="scheduleTarget.coverUrl"
            :src="scheduleTarget.coverUrl"
            alt=""
            class="size-24 shrink-0 rounded-lg object-cover"
          />
          <div class="flex flex-1 flex-col gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-sm font-medium">Tono</span>
              <select
                v-model="tone"
                class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-pink-500"
              >
                <option v-for="t in TONES" :key="t.id" :value="t.id">
                  {{ t.label }} — {{ t.hint }}
                </option>
              </select>
            </label>
            <button
              :disabled="generating"
              class="self-start rounded-lg border border-pink-300 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-50"
              @click="generateCaption"
            >
              {{ generating ? "Generando…" : "Generar con Claude" }}
            </button>
          </div>
        </div>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Caption</span>
          <textarea
            v-model="caption"
            rows="5"
            placeholder="Escribe el caption o genéralo con Claude…"
            class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
          ></textarea>
        </label>
        <p class="mt-1 text-right text-xs text-neutral-400">
          {{ caption.length }} / 2200
        </p>

        <label class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-medium">Fecha y hora</span>
          <input
            v-model="scheduledAt"
            type="datetime-local"
            :min="minSchedule"
            class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500"
          />
        </label>

        <p
          v-if="modalError"
          class="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {{ modalError }}
        </p>

        <button
          :disabled="submitting || !caption.trim() || !scheduledAt"
          class="mt-4 w-full rounded-lg bg-pink-600 px-4 py-2.5 font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
          @click="submitSchedule"
        >
          {{ submitting ? "Programando…" : "Programar publicación" }}
        </button>
      </div>
    </div>
  </div>
</template>
