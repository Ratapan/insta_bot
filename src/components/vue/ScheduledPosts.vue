<script setup lang="ts">
import { onMounted, ref } from "vue";

interface ScheduledPost {
  id: string;
  caption: string;
  imageCount: number;
  coverUrl: string | null;
  scheduledAt: string;
  status: "pending" | "publishing" | "published" | "failed" | "canceled";
  error: string | null;
  permalink: string | null;
}

const posts = ref<ScheduledPost[]>([]);
const state = ref<"loading" | "ready" | "error">("loading");
const busyId = ref<string | null>(null);

const STATUS_LABEL: Record<ScheduledPost["status"], string> = {
  pending: "Pendiente",
  publishing: "Publicando…",
  published: "Publicado",
  failed: "Falló",
  canceled: "Cancelado",
};

const STATUS_CLASS: Record<ScheduledPost["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  publishing: "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  canceled: "bg-neutral-200 text-neutral-600",
};

const ERROR_LABEL: Record<string, string> = {
  reconnect: "Tu acceso a Instagram caducó; reconéctalo en Ajustes.",
  not_connected: "No hay cuenta de Instagram conectada.",
  container_failed: "Instagram no pudo procesar las imágenes.",
  too_many_images: "Demasiadas imágenes.",
  meta_error: "Instagram devolvió un error.",
  interrumpido: "Se interrumpió a mitad (reinicio del servidor).",
  unknown: "Error inesperado.",
};

async function load() {
  state.value = "loading";
  try {
    const res = await fetch("/api/instagram/scheduled");
    if (!res.ok) throw new Error();
    posts.value = (await res.json()).posts;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

async function cancel(post: ScheduledPost) {
  if (!confirm("¿Cancelar esta publicación programada?")) return;
  busyId.value = post.id;
  try {
    const res = await fetch("/api/instagram/scheduled", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.id }),
    });
    if (res.ok) await load();
  } finally {
    busyId.value = null;
  }
}

async function retry(post: ScheduledPost) {
  busyId.value = post.id;
  try {
    const res = await fetch("/api/instagram/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.id, action: "retry" }),
    });
    if (res.ok) await load();
  } finally {
    busyId.value = null;
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

onMounted(load);
</script>

<template>
  <div>
    <p v-if="state === 'loading'" class="text-neutral-500">Cargando…</p>

    <p
      v-else-if="state === 'error'"
      class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      No pudimos cargar tus publicaciones programadas. Recarga la página.
    </p>

    <template v-else>
      <p
        v-if="posts.length === 0"
        class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-neutral-500"
      >
        No tienes publicaciones programadas.
        <a href="/app/new" class="text-pink-600 hover:underline">Crea una</a>.
      </p>

      <ul v-else class="flex flex-col gap-3">
        <li
          v-for="post in posts"
          :key="post.id"
          class="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3"
        >
          <div class="relative shrink-0">
            <img
              v-if="post.coverUrl"
              :src="post.coverUrl"
              alt=""
              class="size-20 rounded-lg object-cover"
            />
            <div
              v-else
              class="flex size-20 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400"
            >
              sin imagen
            </div>
            <span
              v-if="post.imageCount > 1"
              class="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white"
            >
              {{ post.imageCount }}
            </span>
          </div>

          <div class="flex min-w-0 flex-1 flex-col">
            <div class="flex items-center justify-between gap-2">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="STATUS_CLASS[post.status]"
              >
                {{ STATUS_LABEL[post.status] }}
              </span>
              <span class="text-xs text-neutral-500">
                {{ formatDateTime(post.scheduledAt) }}
              </span>
            </div>
            <p class="mt-1 line-clamp-2 text-sm text-neutral-700">
              {{ post.caption }}
            </p>
            <p
              v-if="post.status === 'failed' && post.error"
              class="mt-1 text-xs text-red-600"
            >
              {{ ERROR_LABEL[post.error] ?? post.error }}
            </p>

            <div class="mt-2 flex gap-3 text-xs">
              <a
                v-if="post.permalink"
                :href="post.permalink"
                target="_blank"
                rel="noopener"
                class="font-medium text-green-700 hover:underline"
              >
                Ver en Instagram
              </a>
              <button
                v-if="post.status === 'failed'"
                :disabled="busyId === post.id"
                class="font-medium text-pink-600 hover:underline disabled:opacity-50"
                @click="retry(post)"
              >
                Reintentar
              </button>
              <button
                v-if="post.status === 'pending' || post.status === 'failed'"
                :disabled="busyId === post.id"
                class="text-neutral-500 hover:underline disabled:opacity-50"
                @click="cancel(post)"
              >
                Cancelar
              </button>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
