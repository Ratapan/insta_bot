<script setup lang="ts">
import { ref } from "vue";
import { TONES } from "../../lib/tones";
import CaptionOptions from "./CaptionOptions.vue";

interface IgMedia {
  id: string;
  caption: string | null;
  media_url: string;
  thumbnail_url?: string;
  media_type: string;
  timestamp: string;
  permalink: string;
}

const props = defineProps<{
  media: IgMedia;
}>();

const emit = defineEmits<{
  close: [];
}>();

const context = ref("");
const tone = ref(TONES[0].id);
const withHashtags = ref(true);
const loading = ref(false);
const error = ref<string | null>(null);
const options = ref<Array<{ caption: string; style: string }> | null>(null);
const logId = ref("");

const ERROR_MESSAGES: Record<string, string> = {
  reconnect:
    "Tu acceso a Instagram caducó. Ve a Ajustes y vuelve a conectar tu cuenta.",
  claude_unavailable:
    "Claude está saturado ahora mismo. Espera unos segundos y reinténtalo.",
  claude_parse: "La respuesta de Claude no fue válida. Reinténtalo.",
  image_fetch_failed: "No pudimos descargar la imagen del post.",
  rate_limited:
    "Has alcanzado el límite de generaciones por hora. Espera un poco antes de seguir.",
};

async function generate() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/captions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "ig",
        igMediaId: props.media.id,
        context: context.value,
        tone: tone.value,
        withHashtags: withHashtags.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      error.value =
        ERROR_MESSAGES[data.error] ?? "Algo ha ido mal. Inténtalo de nuevo.";
      return;
    }
    options.value = data.options;
    logId.value = data.logId;
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    loading.value = false;
  }
}

const previewUrl =
  props.media.media_type === "VIDEO" && props.media.thumbnail_url
    ? props.media.thumbnail_url
    : props.media.media_url;
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    @click.self="emit('close')"
  >
    <div
      class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-neutral-50 p-5 sm:rounded-2xl"
    >
      <div class="mb-4 flex items-start justify-between gap-4">
        <h2 class="text-lg font-bold">Generar captions</h2>
        <button
          class="rounded-lg p-1 text-neutral-500 hover:bg-neutral-200"
          aria-label="Cerrar"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <img
        :src="previewUrl"
        alt=""
        class="mb-4 aspect-square w-full rounded-xl object-cover"
      />

      <template v-if="!options">
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

        <p
          v-if="error"
          class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {{ error }}
        </p>

        <button
          :disabled="loading"
          class="w-full rounded-lg bg-pink-600 px-4 py-2.5 font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
          @click="generate"
        >
          {{ loading ? "Generando con Claude…" : "Generar 3 opciones" }}
        </button>
      </template>

      <template v-else>
        <CaptionOptions :options="options" :log-id="logId" mode="copy" />

        <p class="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Instagram no permite editar captions de posts ya publicados desde la
          API: copia la opción que más te guste y pégala manualmente en la app.
        </p>

        <div class="mt-3 flex gap-3">
          <a
            :href="media.permalink"
            target="_blank"
            rel="noopener"
            class="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium hover:bg-neutral-100"
          >
            Abrir post en Instagram
          </a>
          <button
            class="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
            @click="options = null"
          >
            Probar otro tono
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
