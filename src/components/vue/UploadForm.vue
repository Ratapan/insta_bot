<script setup lang="ts">
import { computed, ref } from "vue";
import { TONES } from "../../lib/tones";
import CaptionOptions from "./CaptionOptions.vue";
import FileManager from "./FileManager.vue";

interface PickedImage {
  key: string;
  url: string;
  name: string;
}

const MAX_IMAGES = 10;

const images = ref<PickedImage[]>([]);
const showPicker = ref(false);
const uploading = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);

const context = ref("");
const tone = ref(TONES[0].id);
const withHashtags = ref(true);

const generating = ref(false);
const options = ref<Array<{ caption: string; style: string }> | null>(null);
const logId = ref("");

const finalCaption = ref<string | null>(null);
const mode = ref<"now" | "schedule">("now");
const scheduledAt = ref("");
const submitting = ref(false);
const result = ref<
  { type: "published"; permalink: string | null } | { type: "scheduled"; at: string } | null
>(null);

const error = ref<string | null>(null);

const ERROR_MESSAGES: Record<string, string> = {
  not_connected: "Conecta tu cuenta de Instagram en Ajustes antes de publicar.",
  reconnect:
    "Tu acceso a Instagram caducó. Ve a Ajustes y vuelve a conectar tu cuenta.",
  claude_unavailable:
    "Claude está saturado ahora mismo. Espera unos segundos y reinténtalo.",
  claude_parse: "La respuesta de Claude no fue válida. Reinténtalo.",
  image_fetch_failed: "No pudimos leer la imagen desde la biblioteca.",
  image_too_large: "La imagen supera el límite de 5MB para generar captions.",
  unsupported_image: "Ese archivo no es una imagen soportada.",
  container_failed:
    "Instagram no pudo procesar la imagen. Prueba con JPG de proporción entre 4:5 y 1.91:1.",
  caption_too_long: "El caption supera los 2.200 caracteres de Instagram.",
  meta_error: "Instagram devolvió un error al publicar. Inténtalo de nuevo.",
  too_many_images: "Máximo 10 imágenes por publicación.",
  no_images: "Añade al menos una imagen.",
  schedule_in_past: "La fecha de programación debe estar en el futuro.",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

const canAddMore = computed(() => images.value.length < MAX_IMAGES);

// Valor mínimo para el datetime-local (ahora, en hora local).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
const minSchedule = computed(() => toLocalInput(new Date()));

function addImage(img: PickedImage) {
  if (!canAddMore.value) return;
  if (images.value.some((i) => i.key === img.key)) return;
  images.value.push(img);
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  uploading.value = true;
  error.value = null;
  try {
    for (const file of files) {
      if (!canAddMore.value) break;
      const form = new FormData();
      form.append("file", file);
      form.append("path", "subidas");
      const res = await fetch("/api/storage/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        error.value =
          data.error === "too_large"
            ? `"${file.name}" supera el límite de 8MB.`
            : data.error === "unsupported_type"
              ? `"${file.name}" no es una imagen soportada (JPG, PNG, GIF, WebP).`
              : "No se pudo subir la imagen. ¿Está configurado R2?";
        continue;
      }
      addImage({ key: data.key, url: data.url, name: file.name });
    }
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function onPick(file: { key: string; url: string; name: string }) {
  addImage({ key: file.key, url: file.url, name: file.name });
}

function removeImage(index: number) {
  images.value.splice(index, 1);
  // Si quitamos imágenes hay que regenerar el caption (la portada pudo cambiar).
  options.value = null;
  finalCaption.value = null;
}

function moveImage(index: number, dir: -1 | 1) {
  const to = index + dir;
  if (to < 0 || to >= images.value.length) return;
  const arr = images.value;
  [arr[index], arr[to]] = [arr[to], arr[index]];
}

async function generate() {
  if (images.value.length === 0) return;
  generating.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "library",
        // El caption se genera sobre la portada (primera imagen del carrusel).
        storageKey: images.value[0].key,
        context: context.value,
        tone: tone.value,
        withHashtags: withHashtags.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = messageFor(data.error);
      return;
    }
    options.value = data.options;
    logId.value = data.logId;
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    generating.value = false;
  }
}

function onSelect(index: number) {
  finalCaption.value = options.value![index].caption;
}

async function submit() {
  if (images.value.length === 0 || !finalCaption.value?.trim()) return;
  submitting.value = true;
  error.value = null;
  try {
    const storageKeys = images.value.map((i) => i.key);
    if (mode.value === "schedule") {
      if (!scheduledAt.value) {
        error.value = "Elige una fecha y hora.";
        return;
      }
      const res = await fetch("/api/instagram/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKeys,
          caption: finalCaption.value,
          scheduledAt: new Date(scheduledAt.value).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = messageFor(data.error);
        return;
      }
      result.value = { type: "scheduled", at: data.scheduledAt };
    } else {
      const res = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKeys, caption: finalCaption.value }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.value = messageFor(data.error);
        return;
      }
      result.value = { type: "published", permalink: data.permalink };
    }
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    submitting.value = false;
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reset() {
  images.value = [];
  context.value = "";
  options.value = null;
  finalCaption.value = null;
  mode.value = "now";
  scheduledAt.value = "";
  result.value = null;
  error.value = null;
}
</script>

<template>
  <div>
    <!-- Éxito: publicado -->
    <div
      v-if="result?.type === 'published'"
      class="rounded-xl border border-green-200 bg-green-50 p-6 text-center"
    >
      <p class="text-lg font-semibold text-green-800">¡Publicado! 🎉</p>
      <p class="mt-1 text-sm text-green-700">
        Tu post ya está en Instagram con el caption elegido.
      </p>
      <div class="mt-4 flex justify-center gap-3">
        <a
          v-if="result.permalink"
          :href="result.permalink"
          target="_blank"
          rel="noopener"
          class="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
        >
          Ver en Instagram
        </a>
        <button
          class="rounded-lg border border-green-300 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
          @click="reset"
        >
          Publicar otra
        </button>
      </div>
    </div>

    <!-- Éxito: programado -->
    <div
      v-else-if="result?.type === 'scheduled'"
      class="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center"
    >
      <p class="text-lg font-semibold text-blue-800">¡Programado! 🗓️</p>
      <p class="mt-1 text-sm text-blue-700">
        Se publicará el {{ formatDateTime(result.at) }}.
      </p>
      <div class="mt-4 flex justify-center gap-3">
        <a
          href="/app/scheduled"
          class="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Ver programadas
        </a>
        <button
          class="rounded-lg border border-blue-300 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100"
          @click="reset"
        >
          Crear otra
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Paso 1: imágenes -->
      <section class="mb-6 rounded-xl border border-neutral-200 bg-white p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">1. Elige las imágenes</h2>
          <span class="text-xs text-neutral-500">
            {{ images.length }}/{{ MAX_IMAGES }}
          </span>
        </div>

        <!-- Miniaturas seleccionadas -->
        <div v-if="images.length" class="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <div
            v-for="(img, index) in images"
            :key="img.key"
            class="group relative overflow-hidden rounded-lg border border-neutral-200"
          >
            <img :src="img.url" alt="" class="aspect-square w-full object-cover" />
            <span
              v-if="index === 0"
              class="absolute left-1 top-1 rounded bg-pink-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
            >
              Portada
            </span>
            <div
              class="absolute inset-x-0 bottom-0 flex justify-between bg-black/40 px-1 py-0.5 opacity-0 transition group-hover:opacity-100"
            >
              <button
                class="text-white disabled:opacity-30"
                :disabled="index === 0"
                aria-label="Mover antes"
                @click="moveImage(index, -1)"
              >
                ◀
              </button>
              <button
                class="text-white"
                aria-label="Quitar"
                @click="removeImage(index)"
              >
                ✕
              </button>
              <button
                class="text-white disabled:opacity-30"
                :disabled="index === images.length - 1"
                aria-label="Mover después"
                @click="moveImage(index, 1)"
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            :disabled="uploading || !canAddMore"
            class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="uploadInput?.click()"
          >
            {{ uploading ? "Subiendo…" : "Subir imágenes" }}
          </button>
          <button
            :disabled="!canAddMore"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="showPicker = true"
          >
            Elegir de la biblioteca
          </button>
          <input
            ref="uploadInput"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            class="hidden"
            @change="onUpload"
          />
        </div>
        <p class="mt-3 text-xs text-neutral-500">
          1 imagen = post normal; 2-10 = carrusel. Instagram acepta JPG con
          proporción entre 4:5 y 1.91:1. La primera imagen es la portada.
        </p>
      </section>

      <!-- Paso 2: contexto y tono -->
      <section
        v-if="images.length && !options"
        class="mb-6 rounded-xl border border-neutral-200 bg-white p-5"
      >
        <h2 class="mb-3 font-semibold">2. Cuéntale a Claude</h2>

        <label class="mb-3 flex flex-col gap-1">
          <span class="text-sm font-medium">Contexto (opcional)</span>
          <textarea
            v-model="context"
            rows="3"
            placeholder="¿Dónde estabas? ¿Qué hacías? ¿Con quién?"
            class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
          ></textarea>
        </label>

        <label class="mb-3 flex flex-col gap-1">
          <span class="text-sm font-medium">Tono</span>
          <select
            v-model="tone"
            class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500"
          >
            <option v-for="t in TONES" :key="t.id" :value="t.id">
              {{ t.label }} — {{ t.hint }}
            </option>
          </select>
        </label>

        <label class="mb-4 flex items-center gap-2 text-sm">
          <input
            v-model="withHashtags"
            type="checkbox"
            class="size-4 accent-pink-600"
          />
          Incluir hashtags
        </label>

        <button
          :disabled="generating"
          class="w-full rounded-lg bg-pink-600 px-4 py-2.5 font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
          @click="generate"
        >
          {{ generating ? "Generando con Claude…" : "Generar 3 opciones" }}
        </button>
      </section>

      <!-- Paso 3: elegir opción -->
      <section
        v-if="options && finalCaption === null"
        class="mb-6 rounded-xl border border-neutral-200 bg-white p-5"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">3. Elige tu caption</h2>
          <button
            class="text-sm text-pink-600 hover:underline"
            @click="options = null"
          >
            Probar otro tono
          </button>
        </div>
        <CaptionOptions
          :options="options"
          :log-id="logId"
          mode="select"
          @select="onSelect"
        />
      </section>

      <!-- Paso 4: revisar y publicar / programar -->
      <section
        v-if="finalCaption !== null"
        class="mb-6 rounded-xl border border-neutral-200 bg-white p-5"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold">4. Revisa y publica</h2>
          <button
            class="text-sm text-pink-600 hover:underline"
            @click="finalCaption = null"
          >
            Volver a las opciones
          </button>
        </div>
        <textarea
          v-model="finalCaption"
          rows="6"
          class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
        ></textarea>
        <p class="mt-1 text-right text-xs text-neutral-400">
          {{ finalCaption.length }} / 2200
        </p>

        <!-- Ahora / Programar -->
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
            :class="
              mode === 'now'
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-neutral-300 hover:bg-neutral-100'
            "
            @click="mode = 'now'"
          >
            Publicar ahora
          </button>
          <button
            type="button"
            class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition"
            :class="
              mode === 'schedule'
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-neutral-300 hover:bg-neutral-100'
            "
            @click="mode = 'schedule'"
          >
            Programar
          </button>
        </div>

        <label v-if="mode === 'schedule'" class="mt-3 flex flex-col gap-1">
          <span class="text-sm font-medium">Fecha y hora</span>
          <input
            v-model="scheduledAt"
            type="datetime-local"
            :min="minSchedule"
            class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-pink-500"
          />
        </label>

        <button
          :disabled="
            submitting ||
            !finalCaption.trim() ||
            (mode === 'schedule' && !scheduledAt)
          "
          class="mt-3 w-full rounded-lg bg-pink-600 px-4 py-2.5 font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
          @click="submit"
        >
          <template v-if="submitting">
            {{ mode === "schedule" ? "Programando…" : "Publicando en Instagram…" }}
          </template>
          <template v-else>
            {{
              mode === "schedule"
                ? "Programar publicación"
                : images.length > 1
                  ? "Publicar carrusel"
                  : "Publicar en Instagram"
            }}
          </template>
        </button>
      </section>

      <p
        v-if="error"
        class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ error }}
      </p>
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
          <h2 class="text-lg font-bold">
            Elige imágenes ({{ images.length }}/{{ MAX_IMAGES }})
          </h2>
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
  </div>
</template>
