<script setup lang="ts">
// Cola de revisión del portafolio, con dos modos sobre la misma cola:
//   - "triage": una imagen grande, curado con teclado sin soltar las flechas.
//   - "grid": cuadrícula con multi-selección (clic, shift para rango) y
//     acciones en lote: visible/portafolio/estrellas y series.
// Una serie (díptico/tríptico) es un UUID compartido + orden; se crea desde
// la selección y se gestiona en un panel con arrastre para reordenar,
// propagación de footer y deshacer.
// Cada cambio se aplica optimista (la UI primero, PATCH parcial después; si
// falla, revierte solo lo enviado y avisa). La cola se CONGELA al elegir
// sesión/filtro: marcar una imagen como visible no la saca de la cola a
// mitad de revisión.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface TriageImage {
  url: string;
  file: string;
  categories: string[];
  category?: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
  focal?: string;
  focalMm?: number;
  apertura?: number;
  iso?: number;
  velocidad?: string;
  camera?: string;
  lens?: string;
  stars: number;
  portfolio: boolean;
  visible: boolean;
  session?: string | null;
  series?: { id: string; order: number } | null;
}

type PatchableFields = Partial<
  Pick<
    TriageImage,
    "stars" | "visible" | "portfolio" | "series" | "footer" | "footer_en"
  >
>;

const ERROR_MESSAGES: Record<string, string> = {
  invalid_fields: "Hay campos con valores no válidos.",
  not_found: "Esta imagen ya no existe en Mongo. Recarga la cola.",
  portfolio_unavailable:
    "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "ocultas", label: "Ocultas" },
  { id: "sinEstrellas", label: "Sin estrellas" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const images = ref<TriageImage[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const mode = ref<"triage" | "grid">("triage");
const session = ref(""); // "" = todas las sesiones
const filter = ref<FilterId>("todas");

// La cola congelada: lista de URLs fijada en rebuildQueue(). Los docs siguen
// siendo los mismos objetos reactivos de `images`, así que los badges se
// actualizan aunque la membresía no cambie.
const queueUrls = ref<string[]>([]);
const index = ref(0);
const lightbox = ref(false);
const reviewed = ref(new Set<string>());
const strip = ref<HTMLElement | null>(null);

// Selección del modo cuadrícula.
const selected = ref(new Set<string>());
let lastClicked: number | null = null;
const bulkBusy = ref(false);
const bulkProgress = ref({ done: 0, total: 0 });
const bulkStars = ref(3);

// Panel de serie: id de la serie abierta + orden local editable.
const seriesPanel = ref<string | null>(null);
const panelOrder = ref<string[]>([]);
const dragUrl = ref<string | null>(null);

const toast = ref<{ text: string; kind: "error" | "ok" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string, kind: "error" | "ok" = "error") {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

/** Sesión de una imagen: el campo si existe, si no la carpeta de la key. */
function sessionOf(img: TriageImage): string {
  if (img.session) return img.session;
  const m = img.url.match(/\/blog\/images\/([^/]+)\//);
  return m ? m[1] : "(sin sesión)";
}

const sessions = computed(() => {
  const counts = new Map<string, number>();
  for (const img of images.value) {
    const s = sessionOf(img);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // Las sesiones llevan prefijo de fecha: descendente = más recientes primero.
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.name.localeCompare(a.name));
});

/** Imágenes de la sesión elegida (antes de aplicar el filtro de estado). */
const sessionImages = computed(() =>
  session.value
    ? images.value.filter((img) => sessionOf(img) === session.value)
    : images.value,
);

function matchesFilter(img: TriageImage, f: FilterId): boolean {
  if (f === "ocultas") return !img.visible;
  if (f === "sinEstrellas") return !img.stars;
  return true;
}

const filterCounts = computed(() => {
  const counts: Record<FilterId, number> = { todas: 0, ocultas: 0, sinEstrellas: 0 };
  for (const img of sessionImages.value) {
    for (const f of FILTERS) if (matchesFilter(img, f.id)) counts[f.id] += 1;
  }
  return counts;
});

const byUrl = computed(() => new Map(images.value.map((img) => [img.url, img])));

const queue = computed(() =>
  queueUrls.value
    .map((url) => byUrl.value.get(url))
    .filter((img): img is TriageImage => img !== undefined),
);

const current = computed<TriageImage | null>(
  () => queue.value[index.value] ?? null,
);

const reviewedCount = computed(
  () => queue.value.filter((img) => reviewed.value.has(img.url)).length,
);

const hiddenCount = computed(
  () => queue.value.filter((img) => !img.visible).length,
);

const selectedImages = computed(() =>
  queue.value.filter((img) => selected.value.has(img.url)),
);

const selectionHasSeries = computed(() =>
  selectedImages.value.some((img) => img.series),
);

function rebuildQueue() {
  queueUrls.value = sessionImages.value
    .filter((img) => matchesFilter(img, filter.value))
    .map((img) => img.url);
  index.value = 0;
  selected.value.clear();
  lastClicked = null;
}

watch([session, filter], rebuildQueue);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await fetch("/api/portfolio/review");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "unknown");
    images.value = data.images;
    rebuildQueue();
  } catch (err) {
    loadError.value = messageFor(err instanceof Error ? err.message : "unknown");
  } finally {
    loading.value = false;
  }
}

function goTo(i: number) {
  if (i < 0 || i >= queue.value.length) return;
  index.value = i;
}

function openInTriage(i: number) {
  index.value = i;
  mode.value = "triage";
}

// Al movernos: centrar la miniatura actual y precargar la siguiente imagen
// para que la navegación con flechas no espere a la red.
watch(index, async () => {
  await nextTick();
  strip.value
    ?.querySelector('[data-current="true"]')
    ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  const next = queue.value[index.value + 1];
  if (next) new Image().src = next.url;
});

/**
 * Cambio optimista: aplica en la UI, manda el PATCH parcial y, si el servidor
 * dice que no, revierte SOLO los campos enviados (no pisa otros cambios que
 * ya estén en vuelo). La respuesta OK no se copia de vuelta por lo mismo.
 */
async function patchImage(
  img: TriageImage,
  fields: PatchableFields,
  notify = true,
): Promise<boolean> {
  const prev: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    prev[key] = img[key as keyof TriageImage];
  }
  Object.assign(img, fields);
  reviewed.value.add(img.url);

  try {
    const res = await fetch("/api/portfolio/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: img.url, ...fields }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "unknown");
    }
    return true;
  } catch (err) {
    Object.assign(img, prev);
    if (notify) showToast(messageFor(err instanceof Error ? err.message : "unknown"));
    return false;
  }
}

function setStars(n: number) {
  if (!current.value) return;
  // Clic/tecla en la nota ya activa = quitarla.
  patchImage(current.value, { stars: n === current.value.stars ? 0 : n });
}

// ---------- Selección y acciones en lote (modo cuadrícula) ----------

function toggleSelect(i: number, shift: boolean) {
  const img = queue.value[i];
  if (!img) return;
  if (shift && lastClicked !== null) {
    // Rango: selecciona (no alterna) todo entre el último clic y este.
    const [from, to] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
    for (let k = from; k <= to; k++) selected.value.add(queue.value[k]!.url);
  } else if (selected.value.has(img.url)) {
    selected.value.delete(img.url);
  } else {
    selected.value.add(img.url);
  }
  lastClicked = i;
}

function selectAll() {
  for (const img of queue.value) selected.value.add(img.url);
}

function clearSelection() {
  selected.value.clear();
  lastClicked = null;
}

/** Aplica un PATCH a toda la selección, secuencial, con progreso y resumen. */
async function bulkPatch(
  fields: PatchableFields | ((img: TriageImage) => PatchableFields),
) {
  const targets = selectedImages.value;
  if (targets.length === 0 || bulkBusy.value) return;
  bulkBusy.value = true;
  bulkProgress.value = { done: 0, total: targets.length };
  let failed = 0;
  for (const img of targets) {
    const f = typeof fields === "function" ? fields(img) : fields;
    if (!(await patchImage(img, f, false))) failed += 1;
    bulkProgress.value.done += 1;
  }
  bulkBusy.value = false;
  if (failed > 0) {
    showToast(`${failed} de ${targets.length} no se pudieron guardar.`);
  }
}

// ---------- Series ----------

function seriesSize(id: string): number {
  return images.value.filter((img) => img.series?.id === id).length;
}

async function createSeries() {
  const targets = selectedImages.value;
  if (targets.length < 2) return;
  const id = crypto.randomUUID();
  // El orden inicial es el de la cola (que sigue el nombre de archivo).
  await bulkPatch((img) => ({
    series: { id, order: targets.indexOf(img) },
  }));
  clearSelection();
  openSeriesPanel(id);
}

function removeSeriesFromSelection() {
  bulkPatch({ series: null });
}

function openSeriesPanel(id: string) {
  const members = images.value
    .filter((img) => img.series?.id === id)
    .sort((a, b) => (a.series?.order ?? 0) - (b.series?.order ?? 0));
  if (members.length === 0) return;
  panelOrder.value = members.map((img) => img.url);
  seriesPanel.value = id;
}

function closeSeriesPanel() {
  seriesPanel.value = null;
  panelOrder.value = [];
  dragUrl.value = null;
}

const panelMembers = computed(() =>
  panelOrder.value
    .map((url) => byUrl.value.get(url))
    .filter((img): img is TriageImage => img !== undefined),
);

const panelOrderChanged = computed(() =>
  panelMembers.value.some((img, i) => img.series?.order !== i),
);

/** Footer que se propagaría: el de la primera imagen del orden actual. */
const panelFooterSource = computed(() => {
  const first = panelMembers.value[0];
  if (!first) return null;
  return first.footer || first.footer_en ? first : null;
});

function moveInPanel(url: string, delta: -1 | 1) {
  const arr = [...panelOrder.value];
  const i = arr.indexOf(url);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  panelOrder.value = arr;
}

function onDropInPanel(targetUrl: string) {
  const from = dragUrl.value;
  dragUrl.value = null;
  if (!from || from === targetUrl) return;
  const arr = panelOrder.value.filter((u) => u !== from);
  arr.splice(arr.indexOf(targetUrl), 0, from);
  panelOrder.value = arr;
}

async function savePanelOrder() {
  if (!seriesPanel.value || bulkBusy.value) return;
  const id = seriesPanel.value;
  bulkBusy.value = true;
  let failed = 0;
  for (const [i, img] of panelMembers.value.entries()) {
    if (img.series?.order === i) continue;
    if (!(await patchImage(img, { series: { id, order: i } }, false))) failed += 1;
  }
  bulkBusy.value = false;
  if (failed > 0) showToast(`${failed} imágenes no guardaron su orden.`);
}

/** Copia el footer (es/en) de la primera imagen de la serie al resto. */
async function propagateFooter() {
  const src = panelFooterSource.value;
  if (!src || bulkBusy.value) return;
  const fields: PatchableFields = {};
  if (src.footer) fields.footer = src.footer;
  if (src.footer_en) fields.footer_en = src.footer_en;
  bulkBusy.value = true;
  let failed = 0;
  for (const img of panelMembers.value) {
    if (img.url === src.url) continue;
    if (!(await patchImage(img, fields, false))) failed += 1;
  }
  bulkBusy.value = false;
  if (failed > 0) showToast(`${failed} imágenes no recibieron el footer.`);
  else showToast("Footer propagado al resto de la serie.", "ok");
}

async function undoSeries() {
  if (!seriesPanel.value || bulkBusy.value) return;
  if (!confirm("¿Deshacer la serie? Las imágenes quedan sueltas (no se borra nada más).")) {
    return;
  }
  bulkBusy.value = true;
  let failed = 0;
  for (const img of panelMembers.value) {
    if (!(await patchImage(img, { series: null }, false))) failed += 1;
  }
  bulkBusy.value = false;
  if (failed > 0) showToast(`${failed} imágenes siguen en la serie.`);
  else closeSeriesPanel();
}

// ---------- Teclado ----------

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

  if (e.key === "Escape") {
    if (seriesPanel.value) {
      closeSeriesPanel();
      e.preventDefault();
    } else if (lightbox.value) {
      lightbox.value = false;
      e.preventDefault();
    }
    return;
  }
  // Los atajos de curado son del modo uno a uno; en cuadrícula manda el mouse.
  if (mode.value !== "triage" || seriesPanel.value || !current.value) return;

  const key = e.key.toLowerCase();
  switch (key) {
    case "arrowright":
      goTo(index.value + 1);
      break;
    case "arrowleft":
      goTo(index.value - 1);
      break;
    case "enter":
      lightbox.value = !lightbox.value;
      break;
    case "v":
      patchImage(current.value, { visible: !current.value.visible });
      break;
    case "p":
      patchImage(current.value, { portfolio: !current.value.portfolio });
      break;
    default:
      if (/^[0-5]$/.test(key)) {
        setStars(Number(key));
      } else {
        return;
      }
  }
  e.preventDefault();
}

function exifLine(img: TriageImage): string {
  const parts = [
    img.focal,
    img.apertura ? `ƒ/${img.apertura}` : null,
    img.iso ? `ISO ${img.iso}` : null,
    img.velocidad,
  ].filter(Boolean);
  return parts.join(" · ");
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  clearTimeout(toastTimer);
});
</script>

<template>
  <p v-if="loading" class="text-neutral-500">Cargando la cola…</p>
  <p
    v-else-if="loadError"
    class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
  >
    {{ loadError }}
  </p>

  <div v-else>
    <!-- Modo + sesión + filtro -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex overflow-hidden rounded-lg border border-neutral-300">
        <button
          v-for="m in [
            { id: 'triage', label: 'Uno a uno' },
            { id: 'grid', label: 'Cuadrícula' },
          ]"
          :key="m.id"
          class="px-3 py-1.5 text-sm font-medium"
          :class="
            mode === m.id
              ? 'bg-neutral-900 text-white'
              : 'bg-white text-neutral-600 hover:bg-neutral-100'
          "
          @click="mode = m.id as 'triage' | 'grid'"
        >
          {{ m.label }}
        </button>
      </div>
      <select
        v-model="session"
        class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
      >
        <option value="">Todas las sesiones ({{ images.length }})</option>
        <option v-for="s in sessions" :key="s.name" :value="s.name">
          {{ s.name }} ({{ s.count }})
        </option>
      </select>
      <div class="flex gap-1">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          class="rounded-full border px-3 py-1 text-xs font-medium"
          :class="
            filter === f.id
              ? 'border-pink-500 bg-pink-50 text-pink-700'
              : 'border-neutral-300 text-neutral-600 hover:border-pink-400'
          "
          @click="filter = f.id"
        >
          {{ f.label }} ({{ filterCounts[f.id] }})
        </button>
      </div>
    </div>

    <p
      v-if="images.length === 0"
      class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
    >
      No hay imágenes en la base del portafolio todavía.
    </p>
    <p
      v-else-if="queue.length === 0"
      class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
    >
      Nada que revisar con este filtro. 🎉
    </p>

    <!-- ============ Modo uno a uno ============ -->
    <div v-else-if="mode === 'triage' && current">
      <!-- Progreso -->
      <div
        class="mb-2 flex items-center justify-between text-sm text-neutral-600"
      >
        <span>
          {{ index + 1 }} / {{ queue.length }}
          <span class="text-neutral-400">·</span>
          {{ reviewedCount }} revisada{{ reviewedCount === 1 ? "" : "s" }}
        </span>
        <span>{{ hiddenCount }} oculta{{ hiddenCount === 1 ? "" : "s" }} en la cola</span>
      </div>
      <div class="mb-4 h-1 overflow-hidden rounded-full bg-neutral-200">
        <div
          class="h-full rounded-full bg-pink-600 transition-all"
          :style="{ width: `${((index + 1) / queue.length) * 100}%` }"
        ></div>
      </div>

      <!-- Imagen actual -->
      <figure
        class="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900"
      >
        <img
          :src="current.url"
          :alt="current.file"
          class="mx-auto max-h-[60vh] w-auto cursor-zoom-in object-contain"
          @click="lightbox = true"
        />
      </figure>

      <!-- Controles de curado -->
      <div
        class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3"
      >
        <div class="flex items-center gap-0.5" aria-label="Estrellas">
          <button
            v-for="n in 5"
            :key="n"
            class="text-2xl leading-none"
            :class="
              n <= current.stars
                ? 'text-amber-500'
                : 'text-neutral-300 hover:text-amber-300'
            "
            :title="`${n} estrella${n === 1 ? '' : 's'}`"
            @click="setStars(n)"
          >
            ★
          </button>
        </div>
        <button
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="
            current.visible
              ? 'bg-green-100 text-green-800'
              : 'bg-amber-100 text-amber-800'
          "
          @click="patchImage(current, { visible: !current.visible })"
        >
          {{ current.visible ? "Visible" : "Oculta" }}
        </button>
        <button
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="
            current.portfolio
              ? 'bg-pink-100 text-pink-800'
              : 'bg-neutral-200 text-neutral-600'
          "
          @click="patchImage(current, { portfolio: !current.portfolio })"
        >
          {{ current.portfolio ? "En portafolio" : "Fuera del portafolio" }}
        </button>
        <button
          v-if="current.series"
          class="rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-800"
          title="Gestionar la serie"
          @click="openSeriesPanel(current.series.id)"
        >
          ⧉ Serie {{ current.series.order + 1 }}/{{ seriesSize(current.series.id) }}
        </button>
        <span class="ml-auto truncate text-xs text-neutral-400">
          {{ current.file }}
        </span>
      </div>

      <!-- Metadata resumida -->
      <div class="mt-2 space-y-1 px-1 text-sm">
        <p v-if="current.caption" class="font-medium">{{ current.caption }}</p>
        <p v-else class="italic text-neutral-400">Sin caption todavía.</p>
        <div v-if="current.categories.length" class="flex flex-wrap gap-1">
          <span
            v-for="(cat, i) in current.categories"
            :key="cat"
            class="rounded-full border px-2 py-0.5 text-xs"
            :class="
              i === 0
                ? 'border-pink-300 bg-pink-50 text-pink-700'
                : 'border-neutral-300 text-neutral-600'
            "
          >
            {{ cat }}
          </span>
        </div>
        <p v-if="exifLine(current)" class="text-xs text-neutral-500">
          {{ exifLine(current) }}
        </p>
      </div>

      <!-- Tira de miniaturas -->
      <div ref="strip" class="mt-4 flex gap-2 overflow-x-auto pb-2">
        <button
          v-for="(img, i) in queue"
          :key="img.url"
          :data-current="i === index ? 'true' : undefined"
          class="relative shrink-0 overflow-hidden rounded-lg"
          :class="
            i === index
              ? 'ring-2 ring-pink-600'
              : 'opacity-70 hover:opacity-100'
          "
          @click="goTo(i)"
        >
          <img
            :src="img.url"
            :alt="img.file"
            loading="lazy"
            class="h-16 w-16 object-cover"
          />
          <!-- Puntito de estado: verde visible, ámbar oculta -->
          <span
            class="absolute right-1 top-1 h-2 w-2 rounded-full"
            :class="img.visible ? 'bg-green-500' : 'bg-amber-500'"
          ></span>
        </button>
      </div>

      <p class="mt-3 text-xs text-neutral-500">
        ⌨️ <kbd>←</kbd>/<kbd>→</kbd> navegar · <kbd>1</kbd>–<kbd>5</kbd>
        estrellas (<kbd>0</kbd> quita, repetir también) · <kbd>V</kbd> visible ·
        <kbd>P</kbd> portafolio · <kbd>Enter</kbd> ampliar · <kbd>Esc</kbd>
        cerrar
      </p>
    </div>

    <!-- ============ Modo cuadrícula ============ -->
    <div v-else-if="mode === 'grid'">
      <div class="mb-3 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <span>
          {{ selected.size }} seleccionada{{ selected.size === 1 ? "" : "s" }}
          de {{ queue.length }}
        </span>
        <button class="text-pink-600 hover:underline" @click="selectAll">
          Todas
        </button>
        <button class="text-pink-600 hover:underline" @click="clearSelection">
          Ninguna
        </button>
        <span class="ml-auto text-xs text-neutral-400">
          Clic selecciona · Shift+clic rango · 🔍 abre en uno a uno
        </span>
      </div>

      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        <div
          v-for="(img, i) in queue"
          :key="img.url"
          class="group relative cursor-pointer overflow-hidden rounded-lg border-2"
          :class="
            selected.has(img.url)
              ? 'border-pink-600'
              : 'border-transparent hover:border-neutral-300'
          "
          @click="toggleSelect(i, $event.shiftKey)"
        >
          <img
            :src="img.url"
            :alt="img.file"
            loading="lazy"
            class="aspect-square w-full object-cover"
            :class="selected.has(img.url) ? '' : 'group-hover:opacity-90'"
          />
          <!-- Check de selección -->
          <span
            v-if="selected.has(img.url)"
            class="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-pink-600 text-xs font-bold text-white"
          >
            ✓
          </span>
          <!-- Estado + serie + estrellas -->
          <span
            class="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"
            :class="img.visible ? 'bg-green-500' : 'bg-amber-500'"
          ></span>
          <div
            class="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-xs text-white"
          >
            <span v-if="img.stars">★{{ img.stars }}</span>
            <button
              v-if="img.series"
              class="rounded bg-indigo-500/90 px-1 font-medium hover:bg-indigo-400"
              :title="`Serie ${img.series.order + 1}/${seriesSize(img.series.id)}`"
              @click.stop="openSeriesPanel(img.series.id)"
            >
              ⧉{{ img.series.order + 1 }}
            </button>
            <button
              class="ml-auto opacity-0 transition group-hover:opacity-100"
              title="Abrir en uno a uno"
              @click.stop="openInTriage(i)"
            >
              🔍
            </button>
          </div>
        </div>
      </div>

      <!-- Barra de acciones en lote -->
      <div
        v-if="selected.size > 0"
        class="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-lg"
      >
        <span v-if="bulkBusy" class="text-sm font-medium text-neutral-600">
          Aplicando… {{ bulkProgress.done }}/{{ bulkProgress.total }}
        </span>
        <template v-else>
          <button
            class="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-200"
            @click="bulkPatch({ visible: true })"
          >
            Visibles
          </button>
          <button
            class="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
            @click="bulkPatch({ visible: false })"
          >
            Ocultas
          </button>
          <button
            class="rounded-lg bg-pink-100 px-3 py-1.5 text-xs font-medium text-pink-800 hover:bg-pink-200"
            @click="bulkPatch({ portfolio: true })"
          >
            Al portafolio
          </button>
          <button
            class="rounded-lg bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-300"
            @click="bulkPatch({ portfolio: false })"
          >
            Fuera del portafolio
          </button>
          <span class="flex items-center gap-1 text-xs">
            <select
              v-model.number="bulkStars"
              class="rounded-lg border border-neutral-300 px-1.5 py-1 text-xs"
            >
              <option v-for="n in [0, 1, 2, 3, 4, 5]" :key="n" :value="n">
                {{ n }}★
              </option>
            </select>
            <button
              class="rounded-lg bg-amber-100 px-2 py-1.5 font-medium text-amber-800 hover:bg-amber-200"
              @click="bulkPatch({ stars: bulkStars })"
            >
              Estrellas
            </button>
          </span>
          <span class="mx-1 h-5 w-px bg-neutral-200"></span>
          <button
            :disabled="selected.size < 2"
            class="rounded-lg bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-200 disabled:opacity-40"
            title="Agrupa la selección como díptico/tríptico"
            @click="createSeries"
          >
            ⧉ Crear serie
          </button>
          <button
            v-if="selectionHasSeries"
            class="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            @click="removeSeriesFromSelection"
          >
            Quitar serie
          </button>
          <button
            class="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
            @click="clearSelection"
          >
            Deseleccionar
          </button>
        </template>
      </div>
    </div>

    <!-- ============ Panel de serie ============ -->
    <div
      v-if="seriesPanel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeSeriesPanel"
    >
      <div class="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">
            ⧉ Serie de {{ panelMembers.length }} imágenes
          </h2>
          <button
            class="text-sm text-neutral-500 hover:text-neutral-800"
            @click="closeSeriesPanel"
          >
            Cerrar ✕
          </button>
        </div>
        <p class="mb-3 text-xs text-neutral-500">
          Arrastra (o usa ◀ ▶) para reordenar. La primera marca el orden y es
          la fuente del footer.
        </p>

        <div class="flex gap-3 overflow-x-auto pb-2">
          <div
            v-for="(img, i) in panelMembers"
            :key="img.url"
            class="shrink-0 text-center"
            draggable="true"
            @dragstart="dragUrl = img.url"
            @dragover.prevent
            @drop="onDropInPanel(img.url)"
          >
            <div
              class="relative cursor-grab overflow-hidden rounded-lg border-2"
              :class="i === 0 ? 'border-indigo-500' : 'border-neutral-200'"
            >
              <img
                :src="img.url"
                :alt="img.file"
                class="h-28 w-28 object-cover"
              />
              <span
                class="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs font-bold text-white"
              >
                {{ i + 1 }}
              </span>
            </div>
            <div class="mt-1 flex justify-center gap-2 text-sm">
              <button
                :disabled="i === 0"
                class="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
                @click="moveInPanel(img.url, -1)"
              >
                ◀
              </button>
              <button
                :disabled="i === panelMembers.length - 1"
                class="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
                @click="moveInPanel(img.url, 1)"
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            :disabled="!panelOrderChanged || bulkBusy"
            class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
            @click="savePanelOrder"
          >
            Guardar orden
          </button>
          <button
            :disabled="!panelFooterSource || bulkBusy"
            :title="
              panelFooterSource
                ? 'Copia el footer (es/en) de la primera al resto'
                : 'La primera imagen no tiene footer que propagar'
            "
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40"
            @click="propagateFooter"
          >
            Propagar footer
          </button>
          <button
            :disabled="bulkBusy"
            class="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            @click="undoSeries"
          >
            Deshacer serie
          </button>
        </div>
      </div>
    </div>

    <!-- Lightbox -->
    <div
      v-if="lightbox && current"
      class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
      @click="lightbox = false"
    >
      <img
        :src="current.url"
        :alt="current.file"
        class="max-h-full max-w-full object-contain"
      />
    </div>

    <!-- Aviso flotante (los PATCH fallidos revierten y avisan aquí) -->
    <div
      v-if="toast"
      class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg"
      :class="toast.kind === 'error' ? 'bg-red-600' : 'bg-neutral-900'"
    >
      {{ toast.text }}
    </div>
  </div>
</template>
