<script setup lang="ts">
// Cola de revisión del portafolio: una imagen grande + tira de miniaturas,
// pensada para curar con teclado sin soltar las flechas. Cada cambio se
// aplica optimista (la UI primero, PATCH parcial después; si falla, revierte
// y avisa). La cola se CONGELA al elegir sesión/filtro: marcar una imagen
// como visible no la saca de la cola a mitad de revisión.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface TriageImage {
  url: string;
  file: string;
  categories: string[];
  category?: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
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
}

type PatchableFields = Partial<
  Pick<TriageImage, "stars" | "visible" | "portfolio">
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

const toast = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string) {
  toast.value = message;
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

function rebuildQueue() {
  queueUrls.value = sessionImages.value
    .filter((img) => matchesFilter(img, filter.value))
    .map((img) => img.url);
  index.value = 0;
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
async function patchImage(img: TriageImage, fields: PatchableFields) {
  const prev: PatchableFields = {};
  for (const key of Object.keys(fields) as (keyof PatchableFields)[]) {
    (prev as Record<string, unknown>)[key] = img[key];
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
  } catch (err) {
    Object.assign(img, prev);
    showToast(messageFor(err instanceof Error ? err.message : "unknown"));
  }
}

function setStars(n: number) {
  if (!current.value) return;
  // Clic en la estrella ya activa = quitar la nota.
  patchImage(current.value, {
    stars: n === current.value.stars ? 0 : n,
  });
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

  if (e.key === "Escape") {
    if (lightbox.value) {
      lightbox.value = false;
      e.preventDefault();
    }
    return;
  }
  if (!current.value) return;

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
    <!-- Sesión + filtro -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
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

    <div v-else-if="current">
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
        <span class="ml-auto truncate text-xs text-neutral-400">
          {{ current.file }}
        </span>
      </div>

      <!-- Metadata resumida -->
      <div class="mt-2 space-y-1 px-1 text-sm">
        <p v-if="current.caption" class="font-medium">{{ current.caption }}</p>
        <p v-else class="italic text-neutral-400">Sin caption todavía.</p>
        <div
          v-if="current.categories.length"
          class="flex flex-wrap gap-1"
        >
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

    <!-- Aviso de error (los PATCH fallidos revierten y avisan aquí) -->
    <div
      v-if="toast"
      class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
