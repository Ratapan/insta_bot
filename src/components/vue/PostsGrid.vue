<script setup lang="ts">
import { onMounted, ref } from "vue";
import CaptionGenerator from "./CaptionGenerator.vue";

interface IgMedia {
  id: string;
  caption: string | null;
  media_url: string;
  thumbnail_url?: string;
  media_type: string;
  timestamp: string;
  permalink: string;
}

const media = ref<IgMedia[]>([]);
const state = ref<"loading" | "ready" | "not_connected" | "reconnect" | "error">(
  "loading",
);
const selected = ref<IgMedia | null>(null);

onMounted(async () => {
  try {
    const res = await fetch("/api/instagram/media");
    const data = await res.json();
    if (!res.ok) {
      state.value =
        data.error === "not_connected"
          ? "not_connected"
          : data.error === "reconnect"
            ? "reconnect"
            : "error";
      return;
    }
    media.value = data.media;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
});

function previewUrl(item: IgMedia): string {
  return item.media_type === "VIDEO" && item.thumbnail_url
    ? item.thumbnail_url
    : item.media_url;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
</script>

<template>
  <div>
    <p v-if="state === 'loading'" class="text-neutral-500">
      Cargando tus publicaciones…
    </p>

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
      No pudimos cargar tus publicaciones. Recarga la página para reintentar.
    </p>

    <template v-else>
      <p v-if="media.length === 0" class="text-neutral-500">
        Tu cuenta no tiene publicaciones todavía.
      </p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <article
          v-for="item in media"
          :key="item.id"
          class="overflow-hidden rounded-xl border border-neutral-200 bg-white"
        >
          <img
            :src="previewUrl(item)"
            alt=""
            loading="lazy"
            class="aspect-square w-full object-cover"
          />
          <div class="flex flex-col gap-2 p-3">
            <p class="text-xs text-neutral-500">
              {{ formatDate(item.timestamp) }}
            </p>
            <p class="line-clamp-2 min-h-8 text-xs text-neutral-700">
              {{ item.caption || "Sin caption" }}
            </p>
            <button
              class="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              @click="selected = item"
            >
              Generar captions
            </button>
          </div>
        </article>
      </div>
    </template>

    <CaptionGenerator
      v-if="selected"
      :media="selected"
      @close="selected = null"
    />
  </div>
</template>
