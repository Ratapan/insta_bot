<script setup lang="ts">
// Colecciones curadas del portafolio (colección `collections`): lista y editor
// en un mismo componente. Una colección es un ensayo: título e intro
// bilingües, portada y fotos en orden (arrastrar para reordenar). Se puede
// crear desde una sesión (trae sus fotos en orden de captura) y agregar fotos
// sueltas con el selector del bucket. El sitio publica solo las colecciones
// con «Publicada» y, dentro, solo las fotos con visible:true.
import { computed, onMounted, ref } from "vue";
import PortfolioImagePicker from "./PortfolioImagePicker.vue";

interface Summary {
  slug: string;
  title: string;
  published: boolean;
  order: number;
  count: number;
  cover?: string;
  updatedAt: string;
}
interface PhotoInfo {
  url: string;
  exists: boolean;
  visible: boolean;
  caption?: string;
  series?: { id: string; order: number } | null;
}
interface Form {
  title: string;
  title_en: string;
  slug: string;
  intro: string;
  intro_en: string;
  cover: string;
  photos: string[];
  published: boolean;
  order: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "Esa colección ya no existe. Recarga la página.",
  invalid_fields: "Revisa los campos: el título es obligatorio y el slug solo admite a-z, 0-9 y guiones.",
  slug_taken: "Ya existe una colección con ese slug.",
  published_requires_photos: "Una colección publicada necesita al menos una foto.",
  cover_not_in_photos: "La portada tiene que ser una de las fotos de la colección.",
  portfolio_unavailable: "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};
const messageFor = (code: string) => ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";

const view = ref<"list" | "edit">("list");
const collections = ref<Summary[]>([]);
const sessions = ref<{ session: string; count: number }[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref(false);
const sessionToCreate = ref("");

const editingSlug = ref<string | null>(null);
const form = ref<Form>(emptyForm());
const info = ref<Map<string, PhotoInfo>>(new Map());
const pickerOpen = ref(false);
const sessionToAdd = ref("");
const dragIndex = ref<number | null>(null);
const notice = ref<string | null>(null);

function emptyForm(): Form {
  return { title: "", title_en: "", slug: "", intro: "", intro_en: "", cover: "", photos: [], published: false, order: 0 };
}

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "unknown");
  return data;
}

async function loadList() {
  loading.value = true;
  error.value = null;
  try {
    const data = await api("/api/portfolio/collections");
    collections.value = data.collections;
    sessions.value = data.sessions;
  } catch (err) {
    error.value = messageFor((err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function openEditor(slug: string | null) {
  error.value = null;
  notice.value = null;
  editingSlug.value = slug;
  info.value = new Map();
  if (!slug) {
    form.value = emptyForm();
    view.value = "edit";
    return;
  }
  busy.value = true;
  try {
    const data = await api(`/api/portfolio/collection?slug=${encodeURIComponent(slug)}`);
    const c = data.collection;
    form.value = {
      title: c.title ?? "",
      title_en: c.title_en ?? "",
      slug: c.slug,
      intro: c.intro ?? "",
      intro_en: c.intro_en ?? "",
      cover: c.cover ?? "",
      photos: [...(c.photos ?? [])],
      published: !!c.published,
      order: c.order ?? 0,
    };
    info.value = new Map((data.photos as PhotoInfo[]).map((p) => [p.url, p]));
    view.value = "edit";
  } catch (err) {
    error.value = messageFor((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function createFromSession() {
  if (!sessionToCreate.value) return;
  busy.value = true;
  error.value = null;
  try {
    const name = sessionToCreate.value.replace(/^\d+_?/, "").replace(/[_-]+/g, " ").trim() || sessionToCreate.value;
    const data = await api("/api/portfolio/collections", {
      method: "POST",
      body: JSON.stringify({ title: name.charAt(0).toUpperCase() + name.slice(1), fromSession: sessionToCreate.value }),
    });
    sessionToCreate.value = "";
    await openEditor(data.collection.slug);
    notice.value = "Colección creada como borrador con las fotos de la sesión, en orden de captura.";
  } catch (err) {
    error.value = messageFor((err as Error).message);
  } finally {
    busy.value = false;
  }
}

function payload() {
  const f = form.value;
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    title: f.title.trim(),
    title_en: opt(f.title_en),
    slug: f.slug.trim(),
    intro: opt(f.intro),
    intro_en: opt(f.intro_en),
    cover: f.cover && f.photos.includes(f.cover) ? f.cover : undefined,
    photos: f.photos,
    published: f.published,
    order: Number(f.order) || 0,
  };
}

async function save() {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const data = editingSlug.value
      ? await api(`/api/portfolio/collection?slug=${encodeURIComponent(editingSlug.value)}`, {
          method: "PUT",
          body: JSON.stringify(payload()),
        })
      : await api("/api/portfolio/collections", { method: "POST", body: JSON.stringify(payload()) });
    editingSlug.value = data.collection.slug;
    form.value.slug = data.collection.slug;
    form.value.cover = data.collection.cover ?? "";
    notice.value = "Guardado. El sitio lo mostrará en el próximo «Publicar».";
    await refreshInfo();
  } catch (err) {
    error.value = messageFor((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!editingSlug.value || !confirm(`¿Eliminar la colección «${form.value.title}»? Las fotos no se borran.`)) return;
  busy.value = true;
  try {
    await api(`/api/portfolio/collection?slug=${encodeURIComponent(editingSlug.value)}`, { method: "DELETE" });
    await backToList();
  } catch (err) {
    error.value = messageFor((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function backToList() {
  view.value = "list";
  await loadList();
}

/** Estado (visible, etc.) de las fotos recién agregadas: se lee al guardar. */
async function refreshInfo() {
  if (!editingSlug.value) return;
  const data = await api(`/api/portfolio/collection?slug=${encodeURIComponent(editingSlug.value)}`);
  info.value = new Map((data.photos as PhotoInfo[]).map((p) => [p.url, p]));
}

// --- Fotos ---
function addPhoto(url: string) {
  if (!form.value.photos.includes(url)) form.value.photos.push(url);
}
async function addSession() {
  if (!sessionToAdd.value) return;
  try {
    const data = await api(`/api/portfolio/collections?session=${encodeURIComponent(sessionToAdd.value)}`);
    const before = form.value.photos.length;
    for (const url of data.urls as string[]) addPhoto(url);
    notice.value = `Se agregaron ${form.value.photos.length - before} fotos de ${sessionToAdd.value}.`;
    sessionToAdd.value = "";
  } catch (err) {
    error.value = messageFor((err as Error).message);
  }
}
function removePhoto(i: number) {
  const [url] = form.value.photos.splice(i, 1);
  if (form.value.cover === url) form.value.cover = "";
}
function move(i: number, dir: -1 | 1) {
  const j = i + dir;
  const arr = form.value.photos;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
function onDrop(target: number) {
  const from = dragIndex.value;
  dragIndex.value = null;
  if (from === null || from === target) return;
  const arr = form.value.photos;
  const [url] = arr.splice(from, 1);
  arr.splice(target, 0, url);
}

const coverUrl = computed(() => form.value.cover || form.value.photos[0] || "");
const hiddenCount = computed(() => form.value.photos.filter((u) => info.value.get(u) && !info.value.get(u)!.visible).length);

onMounted(loadList);

const input =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none";
const button = "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50";
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</p>
    <p v-if="notice" class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{{ notice }}</p>

    <!-- Lista -->
    <template v-if="view === 'list'">
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="sessionToCreate" class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">
          <option value="">Crear desde sesión…</option>
          <option v-for="s in sessions" :key="s.session" :value="s.session">{{ s.session }} ({{ s.count }})</option>
        </select>
        <button :class="button" :disabled="!sessionToCreate || busy" @click="createFromSession">Crear</button>
        <button class="ml-auto rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500" @click="openEditor(null)">
          + Nueva colección
        </button>
      </div>

      <p v-if="loading" class="text-neutral-500">Cargando colecciones…</p>
      <p v-else-if="!collections.length" class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
        Todavía no hay colecciones. Crea una desde una sesión o desde cero.
      </p>
      <ul v-else class="space-y-2">
        <li v-for="c in collections" :key="c.slug" class="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
          <img v-if="c.cover" :src="c.cover" alt="" loading="lazy" class="h-16 w-16 shrink-0 rounded-lg object-cover" />
          <div v-else class="h-16 w-16 shrink-0 rounded-lg bg-neutral-100" />
          <div class="min-w-0 flex-1">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="c.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
            >
              {{ c.published ? "Publicada" : "Borrador" }}
            </span>
            <h3 class="truncate font-medium">{{ c.title }}</h3>
            <p class="text-xs text-neutral-500">{{ c.count }} fotos · orden {{ c.order }} · /colecciones/{{ c.slug }}/</p>
          </div>
          <button class="rounded px-2 py-1 text-xs font-medium text-pink-600 hover:bg-pink-50" @click="openEditor(c.slug)">Editar</button>
        </li>
      </ul>
    </template>

    <!-- Editor -->
    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <button :class="button" @click="backToList">← Colecciones</button>
        <label class="ml-auto flex items-center gap-2 text-sm">
          <input v-model="form.published" type="checkbox" class="accent-pink-600" />
          Publicada
        </label>
        <button v-if="editingSlug" :class="button" class="text-red-600" :disabled="busy" @click="remove">Eliminar</button>
        <button
          class="rounded-lg bg-pink-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
          :disabled="busy || !form.title.trim()"
          @click="save"
        >
          {{ busy ? "Guardando…" : "Guardar" }}
        </button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <label class="block text-sm">
          <span class="mb-1 block text-neutral-600">Título</span>
          <input v-model="form.title" :class="input" maxlength="120" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-neutral-600">Título en inglés (opcional)</span>
          <input v-model="form.title_en" :class="input" maxlength="120" />
        </label>
        <label class="block text-sm md:col-span-2">
          <span class="mb-1 block text-neutral-600">Intro (texto plano; párrafos separados por una línea en blanco)</span>
          <textarea v-model="form.intro" :class="input" rows="4" maxlength="3000" />
        </label>
        <label class="block text-sm md:col-span-2">
          <span class="mb-1 block text-neutral-600">Intro en inglés (opcional)</span>
          <textarea v-model="form.intro_en" :class="input" rows="4" maxlength="3000" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-neutral-600">Slug (vacío = desde el título)</span>
          <input v-model="form.slug" :class="input" placeholder="mi-coleccion" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-neutral-600">Orden en el sitio (menor primero)</span>
          <input v-model.number="form.order" type="number" min="0" :class="input" />
        </label>
      </div>

      <section class="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="font-medium">Fotos ({{ form.photos.length }})</h2>
          <span class="text-xs text-neutral-500">Arrastra para reordenar. ★ = portada.</span>
          <select v-model="sessionToAdd" class="ml-auto rounded-lg border border-neutral-300 px-2 py-1.5 text-sm">
            <option value="">Agregar sesión…</option>
            <option v-for="s in sessions" :key="s.session" :value="s.session">{{ s.session }} ({{ s.count }})</option>
          </select>
          <button :class="button" :disabled="!sessionToAdd" @click="addSession">Agregar</button>
          <button :class="button" @click="pickerOpen = true">+ Fotos del bucket</button>
        </div>

        <p v-if="hiddenCount" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {{ hiddenCount }} foto(s) tienen visible:false y no saldrán en el sitio hasta que las publiques en la revisión.
        </p>

        <p v-if="!form.photos.length" class="py-6 text-center text-sm text-neutral-500">Sin fotos todavía.</p>
        <ul v-else class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <li
            v-for="(url, i) in form.photos"
            :key="url"
            draggable="true"
            class="group relative overflow-hidden rounded-lg border-2 bg-neutral-100"
            :class="[url === coverUrl ? 'border-pink-500' : 'border-transparent', dragIndex === i ? 'opacity-40' : '']"
            @dragstart="dragIndex = i"
            @dragover.prevent
            @drop.prevent="onDrop(i)"
            @dragend="dragIndex = null"
          >
            <img :src="url" alt="" loading="lazy" class="aspect-square w-full object-cover" :class="info.get(url) && !info.get(url)!.visible ? 'opacity-50' : ''" />
            <span class="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{{ i + 1 }}</span>
            <span v-if="info.get(url) && !info.get(url)!.visible" class="absolute top-1 right-1 rounded bg-amber-500 px-1 text-[10px] text-white">oculta</span>
            <span v-if="info.get(url)?.series" class="absolute bottom-7 left-1 rounded bg-sky-600 px-1 text-[10px] text-white">serie</span>
            <div class="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button type="button" title="Mover antes" :disabled="i === 0" @click="move(i, -1)">←</button>
              <button type="button" title="Usar como portada" @click="form.cover = url">★</button>
              <button type="button" title="Quitar" @click="removePhoto(i)">✕</button>
              <button type="button" title="Mover después" :disabled="i === form.photos.length - 1" @click="move(i, 1)">→</button>
            </div>
          </li>
        </ul>
      </section>

      <PortfolioImagePicker :open="pickerOpen" @select="addPhoto" @close="pickerOpen = false" />
    </template>
  </div>
</template>
