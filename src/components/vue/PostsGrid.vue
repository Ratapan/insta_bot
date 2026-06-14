<script setup lang="ts">
import { onMounted, ref } from "vue";
import CaptionGenerator from "./CaptionGenerator.vue";

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

function childPreview(child: IgMediaChild): string {
  return child.media_type === "VIDEO" && child.thumbnail_url
    ? child.thumbnail_url
    : child.media_url;
}

function previewUrl(item: IgMedia): string {
  if (item.media_type === "VIDEO" && item.thumbnail_url) {
    return item.thumbnail_url;
  }
  if (item.media_url) return item.media_url;
  // Un CAROUSEL_ALBUM no siempre trae media_url propio: usa la 1ª diapositiva.
  const first = item.children?.[0];
  return first ? childPreview(first) : "";
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
          <div class="relative">
            <img
              :src="previewUrl(item)"
              alt=""
              loading="lazy"
              class="aspect-square w-full object-cover"
            />
            <!-- Indicador de carrusel: nº de diapositivas -->
            <span
              v-if="item.media_type === 'CAROUSEL_ALBUM' && item.children?.length"
              class="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
            >
              <svg
                class="size-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M4 16V6a2 2 0 0 1 2-2h10" />
              </svg>
              {{ item.children.length }}
            </span>
          </div>

          <!-- Tira de miniaturas de las diapositivas del álbum -->
          <div
            v-if="item.media_type === 'CAROUSEL_ALBUM' && item.children?.length"
            class="flex gap-1.5 overflow-x-auto px-3 pt-3"
          >
            <div
              v-for="child in item.children"
              :key="child.id"
              class="relative shrink-0"
            >
              <img
                :src="childPreview(child)"
                alt=""
                loading="lazy"
                class="size-12 rounded-md object-cover"
              />
              <span
                v-if="child.media_type === 'VIDEO'"
                class="absolute inset-0 flex items-center justify-center text-white"
                aria-label="Vídeo"
              >
                <svg class="size-4 drop-shadow" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </div>
          </div>

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
