<script setup lang="ts">
// Lista de posts del portafolio (colección `blogs`: tipos blog y repo). Filtros
// por tipo y estado — por defecto TODOS los estados: el gestor necesita ver
// borradores y archivados sin pasos extra (published-only es la vista del sitio,
// no la del admin). Acciones: editar, archivar/restaurar, eliminar.
import { onMounted, ref } from "vue";

interface BlogSummary {
  slug: string;
  title: string;
  type: "blog" | "repo";
  status: "draft" | "published" | "archived";
  excerpt: string;
  mainImage: string;
  publishedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

const blogs = ref<BlogSummary[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const typeFilter = ref<"" | "blog" | "repo">("");
const statusFilter = ref<"" | "draft" | "published" | "archived">(""); // "" = todos
const search = ref("");
const busySlug = ref<string | null>(null);

const toast = ref<{ text: string; kind: "error" | "ok" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string, kind: "error" | "ok" = "error") {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "Ese post ya no existe. Recarga la página.",
  invalid_fields: "Los datos del post no son válidos.",
  slug_taken: "Ya existe un post con ese slug.",
  portfolio_unavailable:
    "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};
function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    const params = new URLSearchParams();
    if (typeFilter.value) params.set("type", typeFilter.value);
    if (statusFilter.value) params.set("status", statusFilter.value);
    if (search.value.trim()) params.set("search", search.value.trim());
    const res = await fetch(`/api/portfolio/blogs?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "unknown");
    blogs.value = data.blogs;
  } catch (err) {
    loadError.value = messageFor(err instanceof Error ? err.message : "unknown");
  } finally {
    loading.value = false;
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};
const STATUS_CLASS: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-700",
  published: "bg-green-100 text-green-800",
  archived: "bg-amber-100 text-amber-800",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
}

// Archivar/restaurar: no hay endpoint de estado parcial, así que se trae el post
// completo y se reenvía con el nuevo estado (el PUT normaliza de paso).
async function setStatus(b: BlogSummary, newStatus: "archived" | "draft") {
  busySlug.value = b.slug;
  try {
    const g = await fetch(`/api/portfolio/blog?slug=${encodeURIComponent(b.slug)}`);
    const gd = await g.json();
    if (!g.ok) {
      showToast(messageFor(gd.error));
      return;
    }
    const e = gd.blog;
    const body: Record<string, unknown> = {
      title: e.title,
      slug: e.slug,
      excerpt: e.excerpt,
      status: newStatus,
      type: e.type,
      mainImage: e.mainImage,
      content: e.content,
      tags: e.tags,
    };
    if (e.description) body.description = e.description;
    if (e.githubUrl) body.githubUrl = e.githubUrl;
    if (e.demoUrl) body.demoUrl = e.demoUrl;
    if (e.technologies?.length) body.technologies = e.technologies;
    if (e.publishedAt) body.publishedAt = e.publishedAt;

    const p = await fetch(`/api/portfolio/blog?slug=${encodeURIComponent(b.slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const pd = await p.json();
    if (!p.ok) {
      showToast(messageFor(pd.error));
      return;
    }
    showToast(
      newStatus === "archived" ? `«${b.title}» archivado.` : `«${b.title}» restaurado a borrador.`,
      "ok",
    );
    await load();
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    busySlug.value = null;
  }
}

async function remove(b: BlogSummary) {
  if (!confirm(`¿Eliminar «${b.title}» definitivamente? Esta acción no se puede deshacer.`)) return;
  busySlug.value = b.slug;
  try {
    const res = await fetch(`/api/portfolio/blog?slug=${encodeURIComponent(b.slug)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(messageFor(data.error));
      return;
    }
    showToast(`«${b.title}» eliminado.`, "ok");
    await load();
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    busySlug.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <!-- Filtros + nuevo -->
    <div class="flex flex-wrap items-center gap-2">
      <select
        v-model="typeFilter"
        class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        @change="load"
      >
        <option value="">Todos los tipos</option>
        <option value="blog">Blogs</option>
        <option value="repo">Repos</option>
      </select>
      <select
        v-model="statusFilter"
        class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        @change="load"
      >
        <option value="">Todos los estados</option>
        <option value="draft">Borradores</option>
        <option value="published">Publicados</option>
        <option value="archived">Archivados</option>
      </select>
      <input
        v-model="search"
        type="text"
        placeholder="Buscar por título…"
        class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        @keydown.enter="load"
      />
      <button
        class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
        @click="load"
      >
        Buscar
      </button>
      <a
        href="/app/portfolio/blogs/nuevo"
        class="ml-auto rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500"
      >
        + Nuevo post
      </a>
    </div>

    <p v-if="loading" class="text-neutral-500">Cargando posts…</p>
    <p v-else-if="loadError" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ loadError }}
    </p>

    <template v-else>
      <p
        v-if="blogs.length === 0"
        class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
      >
        No hay posts con estos filtros. Crea uno con «+ Nuevo post».
      </p>

      <ul v-else class="space-y-2">
        <li
          v-for="b in blogs"
          :key="b.slug"
          class="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3"
        >
          <img
            v-if="b.mainImage"
            :src="b.mainImage"
            :alt="b.title"
            loading="lazy"
            class="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
          <div
            v-else
            class="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-400"
          >
            —
          </div>

          <div class="min-w-0 flex-1">
            <div class="mb-0.5 flex flex-wrap items-center gap-1.5">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-medium"
                :class="STATUS_CLASS[b.status]"
              >
                {{ STATUS_LABEL[b.status] }}
              </span>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                {{ b.type === "repo" ? "Repo" : "Blog" }}
              </span>
            </div>
            <h3 class="truncate font-medium">{{ b.title }}</h3>
            <p class="truncate text-xs text-neutral-500">{{ b.excerpt }}</p>
            <p class="mt-0.5 truncate text-xs text-neutral-400">
              /{{ b.slug }} · actualizado {{ fmtDate(b.updatedAt) }}
            </p>
          </div>

          <div class="flex shrink-0 flex-col items-end gap-1 text-xs">
            <a
              :href="`/app/portfolio/blogs/${b.slug}`"
              class="rounded px-2 py-1 font-medium text-pink-600 hover:bg-pink-50"
            >
              Editar
            </a>
            <button
              v-if="b.status !== 'archived'"
              :disabled="busySlug === b.slug"
              class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
              @click="setStatus(b, 'archived')"
            >
              Archivar
            </button>
            <button
              v-else
              :disabled="busySlug === b.slug"
              class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
              @click="setStatus(b, 'draft')"
            >
              Restaurar
            </button>
            <button
              :disabled="busySlug === b.slug"
              class="rounded px-2 py-1 text-red-500 hover:bg-red-50 disabled:opacity-50"
              @click="remove(b)"
            >
              Eliminar
            </button>
          </div>
        </li>
      </ul>
    </template>

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
