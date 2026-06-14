<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface StorageFolder {
  name: string;
  path: string;
}

interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
}

const props = withDefaults(
  defineProps<{
    /** 'manage': biblioteca completa. 'pick': selector de imagen (Flujo B). */
    mode?: "manage" | "pick";
  }>(),
  { mode: "manage" },
);

const emit = defineEmits<{
  select: [file: StorageFile];
}>();

const path = ref("");
const folders = ref<StorageFolder[]>([]);
const files = ref<StorageFile[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);
const uploadInput = ref<HTMLInputElement | null>(null);

// Selección múltiple para borrar varias imágenes (solo en modo 'manage').
const selecting = ref(false);
const selected = ref<Set<string>>(new Set());

function toggleSelect(key: string) {
  const next = new Set(selected.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selected.value = next;
}

function selectAll() {
  selected.value = new Set(files.value.map((f) => f.key));
}

function clearSelection() {
  selected.value = new Set();
}

function toggleSelecting() {
  selecting.value = !selecting.value;
  if (!selecting.value) clearSelection();
}

async function removeSelected() {
  const targets = [...selected.value];
  if (targets.length === 0) return;
  if (!confirm(`¿Borrar ${targets.length} imágenes?`)) return;
  busy.value = true;
  try {
    const res = await fetch("/api/storage/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    if (!res.ok) {
      alert("No se pudieron borrar las imágenes.");
      return;
    }
    selecting.value = false;
    clearSelection();
    await load();
  } finally {
    busy.value = false;
  }
}

const breadcrumbs = computed(() => {
  const parts = path.value ? path.value.split("/") : [];
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/"),
  }));
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(
      `/api/storage/list?path=${encodeURIComponent(path.value)}`,
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    folders.value = data.folders;
    files.value = data.files;
  } catch {
    error.value =
      "No se pudo cargar la biblioteca. Revisa la configuración de R2.";
  } finally {
    loading.value = false;
  }
}

function navigate(to: string) {
  path.value = to;
  clearSelection();
  load();
}

async function newFolder() {
  const name = prompt("Nombre de la carpeta:");
  if (!name?.trim()) return;
  busy.value = true;
  try {
    const res = await fetch("/api/storage/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path.value, name: name.trim() }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(
        data.error === "invalid_name"
          ? "Nombre no válido (no puede contener barras)."
          : "No se pudo crear la carpeta.",
      );
      return;
    }
    await load();
  } finally {
    busy.value = false;
  }
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  if (selected.length === 0) return;
  busy.value = true;
  try {
    for (const file of selected) {
      const form = new FormData();
      form.append("file", file);
      form.append("path", path.value);
      const res = await fetch("/api/storage/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json();
        alert(
          data.error === "too_large"
            ? `"${file.name}" supera el límite de 8MB.`
            : data.error === "unsupported_type"
              ? `"${file.name}" no es una imagen soportada (JPG, PNG, GIF, WebP).`
              : `No se pudo subir "${file.name}".`,
        );
      }
    }
    await load();
  } finally {
    busy.value = false;
    input.value = "";
  }
}

async function remove(type: "file" | "folder", target: string, name: string) {
  const message =
    type === "folder"
      ? `¿Borrar la carpeta "${name}" y todo su contenido?`
      : `¿Borrar "${name}"?`;
  if (!confirm(message)) return;
  busy.value = true;
  try {
    await fetch("/api/storage/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, target }),
    });
    await load();
  } finally {
    busy.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

onMounted(load);
</script>

<template>
  <div>
    <!-- Barra de acciones -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav class="flex items-center gap-1 text-sm text-neutral-600">
        <button class="font-medium hover:text-pink-600" @click="navigate('')">
          Inicio
        </button>
        <template v-for="crumb in breadcrumbs" :key="crumb.path">
          <span>/</span>
          <button class="hover:text-pink-600" @click="navigate(crumb.path)">
            {{ crumb.name }}
          </button>
        </template>
      </nav>
      <div class="flex flex-wrap gap-2">
        <!-- Modo selección múltiple (solo gestión) -->
        <template v-if="mode === 'manage' && selecting">
          <button
            :disabled="busy || selected.size === 0"
            class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            @click="removeSelected"
          >
            Borrar ({{ selected.size }})
          </button>
          <button
            :disabled="busy"
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="selectAll"
          >
            Todo
          </button>
          <button
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
            @click="toggleSelecting"
          >
            Cancelar
          </button>
        </template>
        <template v-else>
          <button
            v-if="mode === 'manage' && files.length"
            :disabled="busy"
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="toggleSelecting"
          >
            Seleccionar
          </button>
          <button
            :disabled="busy"
            class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="newFolder"
          >
            + Carpeta
          </button>
          <button
            :disabled="busy"
            class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="uploadInput?.click()"
          >
            {{ busy ? "Subiendo…" : "Subir imágenes" }}
          </button>
        </template>
        <input
          ref="uploadInput"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          class="hidden"
          @change="onUpload"
        />
      </div>
    </div>

    <p v-if="loading" class="text-neutral-500">Cargando…</p>
    <p
      v-else-if="error"
      class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {{ error }}
    </p>

    <template v-else>
      <p
        v-if="folders.length === 0 && files.length === 0"
        class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
      >
        Esta carpeta está vacía. Sube imágenes o crea una subcarpeta.
      </p>

      <!-- Carpetas -->
      <div v-if="folders.length" class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          v-for="folder in folders"
          :key="folder.path"
          class="group relative rounded-xl border border-neutral-200 bg-white p-3"
        >
          <button
            class="flex w-full items-center gap-2 text-left text-sm font-medium"
            @click="navigate(folder.path)"
          >
            <span aria-hidden="true">📁</span>
            <span class="truncate">{{ folder.name }}</span>
          </button>
          <button
            v-if="mode === 'manage'"
            class="absolute right-2 top-2 hidden text-xs text-red-500 hover:underline group-hover:block"
            @click="remove('folder', folder.path, folder.name)"
          >
            Borrar
          </button>
        </div>
      </div>

      <!-- Archivos -->
      <div v-if="files.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <figure
          v-for="file in files"
          :key="file.key"
          class="group relative overflow-hidden rounded-xl border bg-white"
          :class="[
            mode === 'pick' ? 'cursor-pointer hover:border-pink-400' : '',
            mode === 'manage' && selecting ? 'cursor-pointer' : '',
            selected.has(file.key)
              ? 'border-pink-500 ring-2 ring-pink-300'
              : 'border-neutral-200',
          ]"
          @click="
            mode === 'pick'
              ? emit('select', file)
              : selecting
                ? toggleSelect(file.key)
                : null
          "
        >
          <img
            :src="file.url"
            :alt="file.name"
            loading="lazy"
            class="aspect-square w-full object-cover"
          />
          <!-- Casilla de selección -->
          <span
            v-if="mode === 'manage' && selecting"
            class="absolute left-2 top-2 flex size-5 items-center justify-center rounded-md border-2 text-xs"
            :class="
              selected.has(file.key)
                ? 'border-pink-500 bg-pink-500 text-white'
                : 'border-white bg-black/30 text-transparent'
            "
            aria-hidden="true"
          >
            ✓
          </span>
          <figcaption class="flex items-center justify-between gap-2 p-2">
            <span class="truncate text-xs text-neutral-700">{{ file.name }}</span>
            <span class="shrink-0 text-xs text-neutral-400">
              {{ formatSize(file.size) }}
            </span>
          </figcaption>
          <div v-if="mode === 'manage' && !selecting" class="px-2 pb-2">
            <button
              class="text-xs text-red-500 hover:underline"
              @click.stop="remove('file', file.key, file.name)"
            >
              Borrar
            </button>
          </div>
          <div v-else-if="mode === 'pick'" class="px-2 pb-2">
            <span class="text-xs font-medium text-pink-600">Elegir</span>
          </div>
        </figure>
      </div>
    </template>
  </div>
</template>
