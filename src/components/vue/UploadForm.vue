<script setup lang="ts">
import { ref } from "vue";
import { TONES } from "../../lib/tones";
import CaptionOptions from "./CaptionOptions.vue";
import FileManager from "./FileManager.vue";

interface PickedImage {
  key: string;
  url: string;
  name: string;
}

const image = ref<PickedImage | null>(null);
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
const publishing = ref(false);
const published = ref<{ permalink: string | null } | null>(null);

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
    "Instagram no pudo procesar la imagen. Prueba con un JPG de proporción entre 4:5 y 1.91:1.",
  caption_too_long: "El caption supera los 2.200 caracteres de Instagram.",
  meta_error: "Instagram devolvió un error al publicar. Inténtalo de nuevo.",
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = null;
  try {
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
          ? "La imagen supera el límite de 8MB."
          : data.error === "unsupported_type"
            ? "Formato no soportado (usa JPG, PNG, GIF o WebP)."
            : "No se pudo subir la imagen. ¿Está configurado R2?";
      return;
    }
    image.value = { key: data.key, url: data.url, name: file.name };
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function onPick(file: { key: string; url: string; name: string }) {
  image.value = { key: file.key, url: file.url, name: file.name };
  showPicker.value = false;
}

async function generate() {
  if (!image.value) return;
  generating.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "library",
        storageKey: image.value.key,
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

async function publish() {
  if (!image.value || !finalCaption.value?.trim()) return;
  publishing.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/instagram/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storageKey: image.value.key,
        caption: finalCaption.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value = messageFor(data.error);
      return;
    }
    published.value = { permalink: data.permalink };
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    publishing.value = false;
  }
}

function reset() {
  image.value = null;
  context.value = "";
  options.value = null;
  finalCaption.value = null;
  published.value = null;
  error.value = null;
}
</script>

<template>
  <div>
    <!-- Éxito -->
    <div
      v-if="published"
      class="rounded-xl border border-green-200 bg-green-50 p-6 text-center"
    >
      <p class="text-lg font-semibold text-green-800">¡Publicado! 🎉</p>
      <p class="mt-1 text-sm text-green-700">
        Tu post ya está en Instagram con el caption elegido.
      </p>
      <div class="mt-4 flex justify-center gap-3">
        <a
          v-if="published.permalink"
          :href="published.permalink"
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

    <template v-else>
      <!-- Paso 1: imagen -->
      <section class="mb-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 class="mb-3 font-semibold">1. Elige la imagen</h2>

        <div v-if="image" class="flex items-center gap-4">
          <img
            :src="image.url"
            alt=""
            class="size-24 rounded-lg object-cover"
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ image.name }}</p>
            <button
              class="mt-1 text-sm text-pink-600 hover:underline"
              @click="image = null; options = null; finalCaption = null"
            >
              Cambiar imagen
            </button>
          </div>
        </div>

        <div v-else class="flex flex-wrap gap-3">
          <button
            :disabled="uploading"
            class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="uploadInput?.click()"
          >
            {{ uploading ? "Subiendo…" : "Subir imagen" }}
          </button>
          <button
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
            @click="showPicker = true"
          >
            Elegir de la biblioteca
          </button>
          <input
            ref="uploadInput"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            class="hidden"
            @change="onUpload"
          />
        </div>
        <p class="mt-3 text-xs text-neutral-500">
          Instagram acepta JPG con proporción entre 4:5 y 1.91:1. Otros formatos
          pueden fallar al publicar.
        </p>
      </section>

      <!-- Paso 2: contexto y tono -->
      <section
        v-if="image && !options"
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

      <!-- Paso 4: revisar y publicar -->
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
        <button
          :disabled="publishing || !finalCaption.trim()"
          class="mt-3 w-full rounded-lg bg-pink-600 px-4 py-2.5 font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
          @click="publish"
        >
          {{ publishing ? "Publicando en Instagram…" : "Publicar en Instagram" }}
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
          <h2 class="text-lg font-bold">Elige una imagen</h2>
          <button
            class="rounded-lg p-1 text-neutral-500 hover:bg-neutral-200"
            aria-label="Cerrar"
            @click="showPicker = false"
          >
            ✕
          </button>
        </div>
        <FileManager mode="pick" @select="onPick" />
      </div>
    </div>
  </div>
</template>
