<script setup lang="ts">
// Barra «Publicar sitio»: el portafolio es estático, así que lo que se edita
// aquí se ve en javiersabando.lat recién después de un build nuevo. Muestra
// cuántos cambios hay desde la última publicación y dispara el build (Deploy
// Hook de Vercel, vía /api/portfolio/publish). Se refresca al volver a la
// pestaña, para contar lo editado en otras pantallas.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface Status {
  configured: boolean;
  lastPublishedAt: string | null;
  pending: { images: number; blogs: number; collections: number; other: boolean } | null;
}

const ERRORS: Record<string, string> = {
  not_configured: "Falta PORTFOLIO_DEPLOY_HOOK_URL en el .env de insta_bot (reinicia el servidor después).",
  publish_failed: "Vercel no aceptó el pedido. Revisa que el Deploy Hook siga existiendo.",
  rate_limited: "Ya se publicó hace menos de un minuto.",
  portfolio_unavailable: "No se pudo leer la base del portafolio.",
};

const status = ref<Status | null>(null);
const busy = ref(false);
const error = ref("");
const notice = ref("");

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const total = computed(() => {
  const p = status.value?.pending;
  return p ? p.images + p.blogs + p.collections + (p.other ? 1 : 0) : null;
});

const summary = computed(() => {
  const s = status.value;
  if (!s) return "Cargando estado…";
  if (!s.configured) return ERRORS.not_configured;
  if (!s.lastPublishedAt || !s.pending) return "Todavía no se publicó desde aquí.";
  const since = fmt(s.lastPublishedAt);
  if (!total.value) return `Sin cambios desde la última publicación (${since}).`;
  const parts = [
    s.pending.images && plural(s.pending.images, "foto", "fotos"),
    s.pending.blogs && plural(s.pending.blogs, "post", "posts"),
    s.pending.collections && plural(s.pending.collections, "colección", "colecciones"),
    s.pending.other && "borrados o vocabulario",
  ].filter(Boolean);
  return `Cambios desde ${since}: ${parts.join(", ")}.`;
});

async function load() {
  try {
    const res = await fetch("/api/portfolio/publish");
    const data = await res.json();
    if (!res.ok) {
      error.value = ERRORS[data.error] ?? "No se pudo leer el estado de publicación.";
      return;
    }
    status.value = data;
  } catch {
    error.value = "No se pudo leer el estado de publicación.";
  }
}

async function publish() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const res = await fetch("/api/portfolio/publish", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.value = ERRORS[data.error] ?? "No se pudo publicar.";
      return;
    }
    notice.value = "Build lanzado: el sitio se actualiza en ~1 minuto.";
    await load();
  } catch {
    error.value = "Sin conexión con el servidor.";
  } finally {
    busy.value = false;
  }
}

const onVisible = () => {
  if (document.visibilityState === "visible") load();
};
onMounted(() => {
  load();
  document.addEventListener("visibilitychange", onVisible);
});
onBeforeUnmount(() => document.removeEventListener("visibilitychange", onVisible));
</script>

<template>
  <div class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
    <div class="min-w-0 text-sm">
      <p class="font-medium text-neutral-800">Sitio público</p>
      <p v-if="error" class="text-red-600">{{ error }}</p>
      <p v-else-if="notice" class="text-emerald-700">{{ notice }}</p>
      <p v-else class="text-neutral-600">{{ summary }}</p>
    </div>
    <button
      type="button"
      class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="busy || !status?.configured"
      @click="publish"
    >
      {{ busy ? "Publicando…" : "🚀 Publicar sitio" }}<span v-if="!busy && total">&nbsp;({{ total }})</span>
    </button>
  </div>
</template>
