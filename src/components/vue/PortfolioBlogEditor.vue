<script setup lang="ts">
// Editor de un post del portafolio (crear o editar; tipos blog y repo). Maneja
// metadatos + editor de bloques (los 5 tipos que el sitio renderiza) + selector
// de imágenes compartido con acción "catalogar" para huérfanas. Sin IA en esta
// fase: solo CRUD. La normalización de la forma legacy (imageUrl→url, fechas,
// order 0..n) y la sanitización del HTML ocurren en el server.
import { computed, onMounted, ref } from "vue";
import PortfolioImagePicker from "./PortfolioImagePicker.vue";
import { BLOG_TONES } from "../../lib/tones";

interface Slide {
  url: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
}
interface Block {
  type: "text" | "image" | "video" | "slide" | "code";
  value?: string;
  url?: string;
  videoUrl?: string;
  language?: string;
  caption?: string;
  caption_en?: string;
  footer?: string;
  footer_en?: string;
  slides?: Slide[];
}

const props = defineProps<{ slug?: string }>();
const isEdit = computed(() => !!props.slug);

// --- Estado del formulario ---
const title = ref("");
const slug = ref("");
const excerpt = ref("");
const description = ref("");
const status = ref<"draft" | "published" | "archived">("draft");
const type = ref<"blog" | "repo">("blog");
const mainImage = ref("");
const githubUrl = ref("");
const demoUrl = ref("");
const technologies = ref<string[]>([]);
const blocks = ref<Block[]>([]);
const tags = ref<string[]>([]);
const publishedAtLocal = ref("");

const currentSlug = ref(props.slug ?? ""); // slug con el que el server tiene el doc
const originalSlug = ref("");
const originalStatus = ref<"draft" | "published" | "archived">("draft");
const droppedBlocks = ref(0);

const loading = ref(isEdit.value);
const loadError = ref<string | null>(null);
const saving = ref(false);

// Chips
const tagInput = ref("");
const techInput = ref("");

// Toast
const toast = ref<{ text: string; kind: "error" | "ok" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string, kind: "error" | "ok" = "error") {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

const ERROR_MESSAGES: Record<string, string> = {
  bad_request: "Petición inválida.",
  invalid_fields: "Revisa los campos: falta algo o hay un valor no válido.",
  not_found: "Ese post ya no existe. Vuelve a la lista.",
  slug_taken: "Ya existe un post con ese slug. Elige otro.",
  portfolio_unavailable:
    "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};
function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

// Aviso al cambiar el slug de un post ya publicado (rompe la URL pública).
const slugWarning = computed(
  () =>
    originalStatus.value === "published" &&
    slug.value.trim() !== "" &&
    slug.value.trim() !== originalSlug.value,
);

const BLOCK_LABEL: Record<string, string> = {
  text: "Texto",
  image: "Imagen",
  video: "Video",
  slide: "Galería",
  code: "Código",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function applyLoaded(b: Record<string, any>) {
  title.value = b.title ?? "";
  slug.value = b.slug ?? "";
  excerpt.value = b.excerpt ?? "";
  description.value = b.description ?? "";
  status.value = b.status ?? "draft";
  type.value = b.type ?? "blog";
  mainImage.value = b.mainImage ?? "";
  githubUrl.value = b.githubUrl ?? "";
  demoUrl.value = b.demoUrl ?? "";
  technologies.value = Array.isArray(b.technologies) ? [...b.technologies] : [];
  blocks.value = Array.isArray(b.content) ? b.content.map((x: Block) => ({ ...x })) : [];
  tags.value = Array.isArray(b.tags) ? [...b.tags] : [];
  publishedAtLocal.value = toLocalInput(b.publishedAt ?? null);
  currentSlug.value = b.slug ?? "";
  originalSlug.value = b.slug ?? "";
  originalStatus.value = b.status ?? "draft";
  droppedBlocks.value = b.droppedBlocks ?? 0;
}

async function loadBlog() {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await fetch(`/api/portfolio/blog?slug=${encodeURIComponent(props.slug!)}`);
    const data = await res.json();
    if (!res.ok) {
      loadError.value = messageFor(data.error);
      return;
    }
    applyLoaded(data.blog);
  } catch {
    loadError.value = messageFor("unknown");
  } finally {
    loading.value = false;
  }
}

// --- Bloques ---
function addBlock(t: Block["type"]) {
  const b: Block = { type: t };
  if (t === "text" || t === "code") b.value = "";
  if (t === "slide") b.slides = [];
  blocks.value.push(b);
}
function moveBlock(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= blocks.value.length) return;
  const arr = blocks.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
function removeBlock(i: number) {
  blocks.value.splice(i, 1);
}
function removeSlide(bi: number, si: number) {
  blocks.value[bi].slides?.splice(si, 1);
}

// --- Importar bloques desde JSON ---
// Permite pegar contenido armado en otro lugar (un array de bloques, o un post
// exportado con su `content`). Solo copia campos reconocidos por cada tipo; el
// server igual sanitiza el HTML y normaliza la forma al guardar.
const IMPORT_TYPES = new Set(["text", "image", "video", "slide", "code"]);
const jsonOpen = ref(false);
const jsonText = ref("");
const jsonMode = ref<"append" | "replace">("append");
const jsonError = ref<string | null>(null);

function importStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function copyCaptions(src: Record<string, any>, dst: Slide) {
  const cap = importStr(src.caption);
  if (cap) dst.caption = cap;
  const capEn = importStr(src.caption_en);
  if (capEn) dst.caption_en = capEn;
  const foot = importStr(src.footer);
  if (foot) dst.footer = foot;
  const footEn = importStr(src.footer_en);
  if (footEn) dst.footer_en = footEn;
}

function normalizeImportedBlock(x: any): Block | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const type = x.type;
  if (!IMPORT_TYPES.has(type)) return null;

  if (type === "text") {
    return { type, value: typeof x.value === "string" ? x.value : "" };
  }
  if (type === "code") {
    const b: Block = { type, value: typeof x.value === "string" ? x.value : "" };
    const lang = importStr(x.language);
    if (lang) b.language = lang;
    return b;
  }
  if (type === "video") {
    const v = importStr(x.videoUrl) ?? importStr(x.url);
    if (!v) return null;
    return { type, videoUrl: v };
  }
  if (type === "image") {
    const url = importStr(x.url) ?? importStr(x.imageUrl);
    if (!url) return null;
    const b: Block = { type, url };
    copyCaptions(x, b);
    return b;
  }
  // slide
  const slides: Slide[] = [];
  if (Array.isArray(x.slides)) {
    for (const s of x.slides) {
      const url = importStr(s?.url) ?? importStr(s?.imageUrl);
      if (!url) continue;
      const slide: Slide = { url };
      copyCaptions(s, slide);
      slides.push(slide);
    }
  }
  if (slides.length === 0) return null;
  return { type: "slide", slides };
}

function importJson() {
  jsonError.value = null;
  const raw = jsonText.value.trim();
  if (!raw) {
    jsonError.value = "Pega el JSON primero.";
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    jsonError.value = "JSON no válido: revisa la sintaxis.";
    return;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).content)
      ? (parsed as any).content
      : null;
  if (!arr) {
    jsonError.value = "Se esperaba un array de bloques (o un objeto con `content`).";
    return;
  }

  let skipped = 0;
  const imported: Block[] = [];
  for (const item of arr) {
    const b = normalizeImportedBlock(item);
    if (b) imported.push(b);
    else skipped++;
  }
  if (imported.length === 0) {
    jsonError.value = "No se reconoció ningún bloque válido (revisa los tipos y las URLs).";
    return;
  }

  if (jsonMode.value === "replace") {
    const prev = blocks.value;
    blocks.value = imported;
    offerUndo("Contenido reemplazado.", () => (blocks.value = prev));
  } else {
    blocks.value.push(...imported);
  }
  jsonText.value = "";
  jsonOpen.value = false;
  const n = imported.length;
  const msg =
    `${n} bloque${n === 1 ? "" : "s"} importado${n === 1 ? "" : "s"}` +
    (skipped ? `, ${skipped} omitido${skipped === 1 ? "" : "s"}` : "");
  showToast(msg, "ok");
}

// --- Chips ---
function addTag() {
  const v = tagInput.value.trim();
  if (v && !tags.value.includes(v)) tags.value.push(v);
  tagInput.value = "";
}
function removeTag(i: number) {
  tags.value.splice(i, 1);
}
function addTech() {
  const v = techInput.value.trim();
  if (v && !technologies.value.includes(v)) technologies.value.push(v);
  techInput.value = "";
}
function removeTech(i: number) {
  technologies.value.splice(i, 1);
}

// --- Selector de imágenes ---
type PickTarget =
  | { kind: "main" }
  | { kind: "block"; index: number }
  | { kind: "slideAdd"; index: number }
  | { kind: "slide"; index: number; slideIndex: number };
const pickerOpen = ref(false);
const pickTarget = ref<PickTarget | null>(null);
function openPicker(target: PickTarget) {
  pickTarget.value = target;
  pickerOpen.value = true;
}
function onPick(url: string) {
  const t = pickTarget.value;
  if (t) {
    if (t.kind === "main") mainImage.value = url;
    else if (t.kind === "block") blocks.value[t.index].url = url;
    else if (t.kind === "slide") blocks.value[t.index].slides![t.slideIndex].url = url;
    else if (t.kind === "slideAdd") {
      const b = blocks.value[t.index];
      if (!b.slides) b.slides = [];
      b.slides.push({ url });
    }
  }
  pickerOpen.value = false;
  pickTarget.value = null;
}

// --- Guardar ---
function validate(): string | null {
  if (!title.value.trim()) return "Falta el título.";
  if (!excerpt.value.trim()) return "Falta el extracto.";
  if (!mainImage.value) return "Falta la imagen principal.";
  for (const [i, b] of blocks.value.entries()) {
    const n = i + 1;
    if (b.type === "text" && !b.value?.trim()) return `El bloque ${n} (texto) está vacío.`;
    if (b.type === "image" && !b.url) return `El bloque ${n} (imagen) no tiene imagen.`;
    if (b.type === "video" && !b.videoUrl?.trim()) return `El bloque ${n} (video) no tiene URL.`;
    if (b.type === "slide" && !(b.slides ?? []).some((s) => s.url))
      return `El bloque ${n} (galería) no tiene imágenes.`;
    if (b.type === "code" && !b.value?.trim()) return `El bloque ${n} (código) está vacío.`;
  }
  return null;
}

function trimmedOrSkip(target: Record<string, unknown>, key: string, value: string | undefined) {
  if (value && value.trim()) target[key] = value.trim();
}

function buildContent(): Record<string, unknown>[] {
  return blocks.value.map((b) => {
    if (b.type === "text") return { type: "text", value: b.value ?? "" };
    if (b.type === "code") {
      const o: Record<string, unknown> = { type: "code", value: b.value ?? "" };
      trimmedOrSkip(o, "language", b.language);
      return o;
    }
    if (b.type === "video") return { type: "video", videoUrl: (b.videoUrl ?? "").trim() };
    if (b.type === "image") {
      const o: Record<string, unknown> = { type: "image", url: b.url };
      trimmedOrSkip(o, "caption", b.caption);
      trimmedOrSkip(o, "caption_en", b.caption_en);
      trimmedOrSkip(o, "footer", b.footer);
      trimmedOrSkip(o, "footer_en", b.footer_en);
      return o;
    }
    // slide
    const slides = (b.slides ?? [])
      .filter((s) => s.url)
      .map((s) => {
        const o: Record<string, unknown> = { url: s.url };
        trimmedOrSkip(o, "caption", s.caption);
        trimmedOrSkip(o, "caption_en", s.caption_en);
        trimmedOrSkip(o, "footer", s.footer);
        trimmedOrSkip(o, "footer_en", s.footer_en);
        return o;
      });
    return { type: "slide", slides };
  });
}

function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: title.value.trim(),
    excerpt: excerpt.value.trim(),
    status: status.value,
    type: type.value,
    mainImage: mainImage.value,
    content: buildContent(),
    tags: [...tags.value],
  };
  const s = slug.value.trim();
  if (s) payload.slug = s;
  if (description.value.trim()) payload.description = description.value.trim();
  if (publishedAtLocal.value) payload.publishedAt = publishedAtLocal.value;
  if (type.value === "repo") {
    if (githubUrl.value.trim()) payload.githubUrl = githubUrl.value.trim();
    if (demoUrl.value.trim()) payload.demoUrl = demoUrl.value.trim();
    if (technologies.value.length) payload.technologies = [...technologies.value];
  }
  return payload;
}

async function save() {
  const err = validate();
  if (err) {
    showToast(err);
    return;
  }
  saving.value = true;
  try {
    const payload = buildPayload();
    const url = isEdit.value
      ? `/api/portfolio/blog?slug=${encodeURIComponent(currentSlug.value)}`
      : "/api/portfolio/blogs";
    const res = await fetch(url, {
      method: isEdit.value ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(messageFor(data.error));
      return;
    }
    if (!isEdit.value) {
      // Redirige a la página de edición del post recién creado.
      window.location.href = `/app/portfolio/blogs/${data.blog.slug}`;
      return;
    }
    // Edición: refresca desde la respuesta normalizada y actualiza la URL si el
    // slug cambió (sin recargar). Hay que leer el slug anterior ANTES de
    // applyLoaded, que ya deja currentSlug en el nuevo valor.
    const prevSlug = currentSlug.value;
    const savedSlug = data.blog.slug;
    applyLoaded(data.blog);
    if (savedSlug !== prevSlug) {
      window.history.replaceState({}, "", `/app/portfolio/blogs/${savedSlug}`);
    }
    showToast("Cambios guardados.", "ok");
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    saving.value = false;
  }
}

// --- Asistencias de IA por campo ---
const aiTone = ref("narrativo");
const aiBusy = ref<string | null>(null); // target en curso: "excerpt", "block:2", "slide:2:0"…
const titleOptions = ref<string[] | null>(null);
const undoAction = ref<{ text: string; restore: () => void } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const AI_ERRORS: Record<string, string> = {
  invalid_fields: "Datos no válidos para generar.",
  invalid_url: "Esa imagen no es del bucket del portafolio.",
  image_fetch_failed: "No se pudo leer la imagen para el caption.",
  rate_limited: "Llegaste al límite de generaciones por hora. Espera un rato.",
  claude_unavailable: "La IA no respondió. ¿Está configurada la API key?",
  generation_parse: "La IA devolvió algo inesperado. Prueba de nuevo.",
};
function aiMessageFor(code: string): string {
  return AI_ERRORS[code] ?? "No se pudo generar. Inténtalo de nuevo.";
}

function offerUndo(text: string, restore: () => void) {
  undoAction.value = { text, restore };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => (undoAction.value = null), 6000);
}
function runUndo() {
  undoAction.value?.restore();
  undoAction.value = null;
}

const stripHtml = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** El content del post como texto plano (para las asistencias de texto). */
function contentAsText(): string {
  const parts: string[] = [];
  for (const b of blocks.value) {
    if (b.type === "text") {
      const t = stripHtml(b.value ?? "");
      if (t) parts.push(t);
    } else if (b.type === "image") {
      parts.push(`[imagen${b.caption ? `: ${b.caption}` : ""}]`);
    } else if (b.type === "slide") {
      const caps = (b.slides ?? []).map((s) => s.caption).filter(Boolean);
      parts.push(`[galería${caps.length ? `: ${caps.join("; ")}` : ""}]`);
    } else if (b.type === "video") {
      parts.push("[video]");
    } else if (b.type === "code") {
      parts.push("[código]");
    }
  }
  return parts.join("\n\n");
}

/** Texto plano del último bloque de texto antes de `index` (para el caption). */
function precedingTextFor(index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const b = blocks.value[i];
    if (b.type === "text") {
      const t = stripHtml(b.value ?? "");
      if (t) return t;
    }
  }
  return undefined;
}

async function callAssist(
  target: string,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  aiBusy.value = target;
  try {
    const res = await fetch("/api/portfolio/blog-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(aiMessageFor(data.error));
      return null;
    }
    return data.suggestion;
  } catch {
    showToast(aiMessageFor("unknown"));
    return null;
  } finally {
    aiBusy.value = null;
  }
}

async function aiField(kind: "excerpt" | "description" | "tags") {
  const suggestion = await callAssist(kind, {
    kind,
    title: title.value,
    contentText: contentAsText(),
    tone: kind === "excerpt" ? aiTone.value : undefined,
  });
  if (suggestion == null) return;
  if (kind === "excerpt" && typeof suggestion === "string") {
    const prev = excerpt.value;
    excerpt.value = suggestion;
    if (prev.trim()) offerUndo("Extracto reemplazado.", () => (excerpt.value = prev));
  } else if (kind === "description" && typeof suggestion === "string") {
    const prev = description.value;
    description.value = suggestion;
    if (prev.trim()) offerUndo("Descripción reemplazada.", () => (description.value = prev));
  } else if (kind === "tags" && Array.isArray(suggestion)) {
    const prev = [...tags.value];
    tags.value = [...new Set(suggestion.map(String))];
    if (prev.length) offerUndo("Tags reemplazados.", () => (tags.value = prev));
  }
}

async function aiTitles() {
  const suggestion = await callAssist("title", {
    kind: "title",
    title: title.value,
    contentText: contentAsText(),
    tone: aiTone.value,
  });
  if (Array.isArray(suggestion) && suggestion.length) {
    titleOptions.value = suggestion.map(String);
  }
}
function pickTitle(t: string) {
  const prev = title.value;
  title.value = t;
  titleOptions.value = null;
  if (prev.trim()) offerUndo("Título reemplazado.", () => (title.value = prev));
}

async function aiCaption(blockIndex: number, slideIndex: number | null = null) {
  const block = blocks.value[blockIndex];
  const url = slideIndex == null ? block.url : block.slides?.[slideIndex]?.url;
  if (!url) {
    showToast("Elige una imagen primero.");
    return;
  }
  const target = slideIndex == null ? `block:${blockIndex}` : `slide:${blockIndex}:${slideIndex}`;
  const current = slideIndex == null ? block.caption : block.slides![slideIndex].caption;
  const currentEn = slideIndex == null ? block.caption_en : block.slides![slideIndex].caption_en;

  const suggestion = await callAssist(target, {
    kind: "image_caption",
    url,
    tone: aiTone.value,
    postTitle: title.value || undefined,
    postExcerpt: excerpt.value || undefined,
    precedingText: precedingTextFor(blockIndex) || undefined,
    currentCaption: current || undefined,
  });
  if (!suggestion || typeof suggestion !== "object") return;
  const cap = suggestion as { caption?: string; caption_en?: string };
  if (!cap.caption) return;

  if (slideIndex == null) {
    block.caption = cap.caption;
    block.caption_en = cap.caption_en;
  } else {
    block.slides![slideIndex].caption = cap.caption;
    block.slides![slideIndex].caption_en = cap.caption_en;
  }
  offerUndo("Caption generado.", () => {
    if (slideIndex == null) {
      block.caption = current;
      block.caption_en = currentEn;
    } else {
      block.slides![slideIndex].caption = current;
      block.slides![slideIndex].caption_en = currentEn;
    }
  });
}

onMounted(() => {
  if (isEdit.value) loadBlog();
});
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <a href="/app/portfolio/blogs" class="text-sm text-neutral-600 hover:text-pink-600">
        ← Volver a la lista
      </a>
      <button
        :disabled="saving || loading"
        class="rounded-lg bg-pink-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
        @click="save"
      >
        {{ saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear post" }}
      </button>
    </div>

    <p v-if="loading" class="text-neutral-500">Cargando el post…</p>
    <p v-else-if="loadError" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ loadError }}
    </p>

    <div v-else class="space-y-6">
      <!-- Aviso de bloques no editables descartados (posts legacy con `file`, etc.) -->
      <p
        v-if="droppedBlocks > 0"
        class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        Este post tenía {{ droppedBlocks }} bloque{{ droppedBlocks === 1 ? "" : "s" }} de un
        tipo no editable (p. ej. archivos) que no se muestra{{ droppedBlocks === 1 ? "" : "n" }}
        aquí y se perderá{{ droppedBlocks === 1 ? "" : "n" }} si guardas.
      </p>

      <!-- Barra de asistencias de IA -->
      <div
        class="flex flex-wrap items-center gap-2 rounded-xl border border-pink-200 bg-pink-50 p-3 text-sm"
      >
        <span class="font-medium text-pink-800">✨ Asistencias de IA</span>
        <label class="flex items-center gap-1 text-neutral-700">
          Tono:
          <select
            v-model="aiTone"
            class="rounded-lg border border-neutral-300 px-2 py-1 text-sm focus:border-pink-500 focus:outline-none"
          >
            <option v-for="t in BLOG_TONES" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
        </label>
        <span class="text-xs text-neutral-500">Aplica a título, extracto y captions.</span>
      </div>

      <!-- Metadatos -->
      <section class="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div>
          <div class="mb-1 flex items-center gap-2">
            <label class="block text-sm font-medium">Título</label>
            <button
              type="button"
              :disabled="aiBusy !== null"
              class="rounded border border-pink-300 px-2 py-0.5 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
              @click="aiTitles"
            >
              {{ aiBusy === "title" ? "✨…" : "✨ Sugerir" }}
            </button>
          </div>
          <input
            v-model="title"
            type="text"
            maxlength="200"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          />
          <div
            v-if="titleOptions"
            class="mt-2 space-y-1 rounded-lg border border-pink-200 bg-pink-50 p-2"
          >
            <p class="text-xs text-neutral-600">Elige un título:</p>
            <button
              v-for="(t, i) in titleOptions"
              :key="i"
              type="button"
              class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-white"
              @click="pickTitle(t)"
            >
              {{ t }}
            </button>
            <button
              type="button"
              class="text-xs text-neutral-500 hover:underline"
              @click="titleOptions = null"
            >
              Descartar
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">Slug</label>
          <input
            v-model="slug"
            type="text"
            placeholder="Se genera del título si lo dejas vacío"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          />
          <p class="mt-1 text-xs text-neutral-500">Solo minúsculas, números y guiones.</p>
          <p
            v-if="slugWarning"
            class="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            ⚠️ Este post está publicado. Cambiar el slug rompe su URL actual
            (<span class="font-mono">/{{ originalSlug }}</span>) y cualquier enlace externo.
          </p>
        </div>

        <div>
          <div class="mb-1 flex items-center gap-2">
            <label class="block text-sm font-medium">Extracto</label>
            <button
              type="button"
              :disabled="aiBusy !== null"
              class="rounded border border-pink-300 px-2 py-0.5 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
              @click="aiField('excerpt')"
            >
              {{ aiBusy === "excerpt" ? "✨…" : "✨ Sugerir" }}
            </button>
          </div>
          <textarea
            v-model="excerpt"
            rows="2"
            maxlength="500"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>

        <div>
          <div class="mb-1 flex items-center gap-2">
            <label class="block text-sm font-medium">Descripción (opcional)</label>
            <button
              type="button"
              :disabled="aiBusy !== null"
              class="rounded border border-pink-300 px-2 py-0.5 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
              @click="aiField('description')"
            >
              {{ aiBusy === "description" ? "✨…" : "✨ SEO" }}
            </button>
          </div>
          <textarea
            v-model="description"
            rows="2"
            maxlength="1000"
            class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          ></textarea>
        </div>

        <div class="flex flex-wrap gap-4">
          <div>
            <label class="mb-1 block text-sm font-medium">Estado</label>
            <select
              v-model="status"
              class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            >
              <option value="draft">Borrador</option>
              <option value="published">Publicado</option>
              <option value="archived">Archivado</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Tipo</label>
            <select
              v-model="type"
              class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            >
              <option value="blog">Blog</option>
              <option value="repo">Repo</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Fecha de publicación</label>
            <input
              v-model="publishedAtLocal"
              type="datetime-local"
              class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
            <p class="mt-1 text-xs text-neutral-500">
              Se completa sola al publicar si la dejas vacía.
            </p>
          </div>
        </div>

        <!-- Imagen principal -->
        <div>
          <label class="mb-1 block text-sm font-medium">Imagen principal</label>
          <div class="flex items-center gap-3">
            <img
              v-if="mainImage"
              :src="mainImage"
              alt="Imagen principal"
              class="h-24 w-24 rounded-lg object-cover"
            />
            <div
              v-else
              class="flex h-24 w-24 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400"
            >
              sin imagen
            </div>
            <button
              class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
              @click="openPicker({ kind: 'main' })"
            >
              {{ mainImage ? "Cambiar imagen" : "Elegir imagen" }}
            </button>
          </div>
        </div>

        <!-- Campos de repo (solo type=repo) -->
        <div v-if="type === 'repo'" class="space-y-3 rounded-lg bg-neutral-50 p-3">
          <div>
            <label class="mb-1 block text-sm font-medium">GitHub URL</label>
            <input
              v-model="githubUrl"
              type="text"
              placeholder="https://github.com/usuario/repo"
              class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Demo URL</label>
            <input
              v-model="demoUrl"
              type="text"
              placeholder="https://…"
              class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Tecnologías</label>
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="(t, i) in technologies"
                :key="i"
                class="flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-xs"
              >
                {{ t }}
                <button class="text-neutral-500 hover:text-red-600" @click="removeTech(i)">✕</button>
              </span>
              <input
                v-model="techInput"
                type="text"
                placeholder="Añadir…"
                class="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-xs focus:border-pink-500 focus:outline-none"
                @keydown.enter.prevent="addTech"
              />
            </div>
          </div>
        </div>

        <!-- Tags -->
        <div>
          <div class="mb-1 flex items-center gap-2">
            <label class="block text-sm font-medium">Tags</label>
            <button
              type="button"
              :disabled="aiBusy !== null"
              class="rounded border border-pink-300 px-2 py-0.5 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
              @click="aiField('tags')"
            >
              {{ aiBusy === "tags" ? "✨…" : "✨ Sugerir" }}
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-for="(t, i) in tags"
              :key="i"
              class="flex items-center gap-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-800"
            >
              {{ t }}
              <button class="text-pink-500 hover:text-red-600" @click="removeTag(i)">✕</button>
            </span>
            <input
              v-model="tagInput"
              type="text"
              placeholder="Añadir…"
              class="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-xs focus:border-pink-500 focus:outline-none"
              @keydown.enter.prevent="addTag"
            />
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Lista libre; no se conecta al vocabulario de imágenes.
          </p>
        </div>
      </section>

      <!-- Bloques de contenido -->
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-neutral-700">Contenido ({{ blocks.length }})</h2>
        </div>

        <!-- Importar desde JSON -->
        <div class="rounded-xl border border-neutral-200 bg-white">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-neutral-700 hover:text-pink-600"
            @click="jsonOpen = !jsonOpen"
          >
            <span>Importar contenido desde JSON</span>
            <span class="text-neutral-400">{{ jsonOpen ? "▲" : "▼" }}</span>
          </button>
          <div v-if="jsonOpen" class="space-y-2 border-t border-neutral-100 p-3">
            <p class="text-xs text-neutral-500">
              Pega un array de bloques (o un objeto con <span class="font-mono">content</span>)
              con la misma forma que guarda el editor. Tipos:
              <span class="font-mono">text, image, video, slide, code</span>.
            </p>
            <textarea
              v-model="jsonText"
              rows="6"
              spellcheck="false"
              placeholder='[ { "type": "text", "value": "&lt;p&gt;Hola&lt;/p&gt;" }, { "type": "image", "url": "https://…", "caption": "…" } ]'
              class="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-pink-500 focus:outline-none"
            ></textarea>
            <p v-if="jsonError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {{ jsonError }}
            </p>
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex items-center gap-1 text-xs text-neutral-600">
                <input v-model="jsonMode" type="radio" value="append" /> Añadir al final
              </label>
              <label class="flex items-center gap-1 text-xs text-neutral-600">
                <input v-model="jsonMode" type="radio" value="replace" /> Reemplazar todo
              </label>
              <button
                type="button"
                class="ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
                @click="importJson"
              >
                Importar
              </button>
            </div>
          </div>
        </div>

        <div
          v-for="(b, i) in blocks"
          :key="i"
          class="rounded-xl border border-neutral-200 bg-white"
        >
          <div class="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
            <span class="text-sm font-medium">
              {{ BLOCK_LABEL[b.type] }} <span class="text-neutral-400">#{{ i + 1 }}</span>
            </span>
            <div class="flex items-center gap-1 text-sm">
              <button
                title="Subir"
                :disabled="i === 0"
                class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30"
                @click="moveBlock(i, -1)"
              >
                ◀
              </button>
              <button
                title="Bajar"
                :disabled="i === blocks.length - 1"
                class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30"
                @click="moveBlock(i, 1)"
              >
                ▶
              </button>
              <button
                title="Quitar"
                class="rounded px-2 py-1 text-red-500 hover:bg-red-50"
                @click="removeBlock(i)"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="p-3">
            <!-- Texto -->
            <div v-if="b.type === 'text'">
              <textarea
                v-model="b.value"
                rows="5"
                placeholder="<p>Escribe en HTML…</p>"
                class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
              ></textarea>
              <p class="mt-1 text-xs text-neutral-500">
                HTML directo. Se conservan p, br, a[href], strong, em, h2, h3, listas,
                blockquote, code, pre; lo demás se elimina al guardar.
              </p>
            </div>

            <!-- Imagen -->
            <div v-else-if="b.type === 'image'" class="space-y-2">
              <div class="flex items-center gap-3">
                <img
                  v-if="b.url"
                  :src="b.url"
                  alt=""
                  class="h-20 w-20 rounded-lg object-cover"
                />
                <div
                  v-else
                  class="flex h-20 w-20 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400"
                >
                  sin imagen
                </div>
                <button
                  class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                  @click="openPicker({ kind: 'block', index: i })"
                >
                  {{ b.url ? "Cambiar imagen" : "Elegir imagen" }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <input
                  v-model="b.caption"
                  type="text"
                  placeholder="Pie de foto (opcional)"
                  class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
                />
                <button
                  type="button"
                  title="Generar pie editorial bilingüe"
                  :disabled="aiBusy !== null || !b.url"
                  class="shrink-0 rounded border border-pink-300 px-2 py-1.5 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
                  @click="aiCaption(i)"
                >
                  {{ aiBusy === `block:${i}` ? "✨…" : "✨" }}
                </button>
              </div>
              <input
                v-model="b.caption_en"
                type="text"
                placeholder="Pie en inglés (opcional)"
                class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 focus:border-pink-500 focus:outline-none"
              />
              <p class="text-xs text-neutral-500">
                El pie y los datos técnicos se completan desde la galería si la imagen está
                catalogada. ✨ genera un pie editorial bilingüe.
              </p>
            </div>

            <!-- Video -->
            <div v-else-if="b.type === 'video'">
              <input
                v-model="b.videoUrl"
                type="text"
                placeholder="https://www.youtube.com/embed/…"
                class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
              />
              <p class="mt-1 text-xs text-neutral-500">URL de embed (YouTube/Vimeo).</p>
            </div>

            <!-- Galería (slide) -->
            <div v-else-if="b.type === 'slide'" class="space-y-2">
              <div
                v-if="(b.slides ?? []).length"
                class="grid grid-cols-3 gap-2 sm:grid-cols-4"
              >
                <div v-for="(s, si) in b.slides" :key="si" class="relative">
                  <img :src="s.url" alt="" class="aspect-square w-full rounded-lg object-cover" />
                  <button
                    title="Quitar"
                    class="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white hover:bg-black/80"
                    @click="removeSlide(i, si)"
                  >
                    ✕
                  </button>
                  <div class="mt-1 flex items-center gap-1">
                    <input
                      v-model="s.caption"
                      type="text"
                      placeholder="Pie"
                      class="w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-pink-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      title="Generar pie editorial bilingüe"
                      :disabled="aiBusy !== null"
                      class="shrink-0 rounded border border-pink-300 px-1.5 py-1 text-xs font-medium text-pink-700 hover:bg-pink-50 disabled:opacity-40"
                      @click="aiCaption(i, si)"
                    >
                      {{ aiBusy === `slide:${i}:${si}` ? "…" : "✨" }}
                    </button>
                  </div>
                  <input
                    v-model="s.caption_en"
                    type="text"
                    placeholder="Pie (EN)"
                    class="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 focus:border-pink-500 focus:outline-none"
                  />
                </div>
              </div>
              <button
                class="rounded-lg border border-dashed border-neutral-400 px-3 py-1.5 text-sm text-neutral-600 hover:border-pink-400"
                @click="openPicker({ kind: 'slideAdd', index: i })"
              >
                Agregar imagen
              </button>
            </div>

            <!-- Código -->
            <div v-else-if="b.type === 'code'" class="space-y-2">
              <input
                v-model="b.language"
                type="text"
                placeholder="Lenguaje (opcional, p. ej. js)"
                class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
              />
              <textarea
                v-model="b.value"
                rows="5"
                class="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-pink-500 focus:outline-none"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- Agregar bloque -->
        <div class="flex flex-wrap gap-2">
          <button
            v-for="t in ['text', 'image', 'video', 'slide', 'code'] as const"
            :key="t"
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
            @click="addBlock(t)"
          >
            + {{ BLOCK_LABEL[t] }}
          </button>
        </div>
      </section>

      <!-- Guardar (repetido abajo para comodidad) -->
      <div class="flex justify-end">
        <button
          :disabled="saving"
          class="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
          @click="save"
        >
          {{ saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear post" }}
        </button>
      </div>
    </div>

    <!-- Selector de imágenes -->
    <PortfolioImagePicker :open="pickerOpen" @select="onPick" @close="pickerOpen = false" />

    <!-- Deshacer (asistencias de IA) -->
    <div
      v-if="undoAction"
      class="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      <span>{{ undoAction.text }}</span>
      <button class="font-medium text-pink-300 hover:text-pink-200" @click="runUndo">
        Deshacer
      </button>
    </div>

    <!-- Aviso flotante -->
    <div
      v-if="toast"
      class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg"
      :class="toast.kind === 'error' ? 'bg-red-600' : 'bg-neutral-900'"
    >
      {{ toast.text }}
    </div>
  </div>
</template>
