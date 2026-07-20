<script setup lang="ts">
// Gestor del vocabulario controlado (colección `tags` + su uso en `images`).
//   - Árbol de dos niveles: tags raíz con sus hijos, cada uno con su conteo
//     de uso real en las imágenes.
//   - Renombrar/fusionar: hace un dry-run (PUT apply:false) para mostrar a
//     cuántas imágenes afecta ANTES de aplicar; si el destino ya existe, es
//     una fusión. La escritura masiva vive en la lib (renameCategoryEverywhere).
//   - Salud: categorías en uso sin tag (huérfanas, con "adoptar") y tags sin
//     uso (con borrar).
import { computed, onMounted, ref } from "vue";

interface Tag {
  name: string;
  parent: string | null;
}
interface Usage {
  name: string;
  count: number;
}

const tags = ref<Tag[]>([]);
const usage = ref<Usage[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

const newName = ref("");
const newParent = ref("");

// Modal de renombrar/fusionar.
const renameFrom = ref<string | null>(null);
const renameTo = ref("");
const renamePreview = ref<{ affected: number; merged: boolean } | null>(null);
const renameBusy = ref(false);

const toast = ref<{ text: string; kind: "error" | "ok" } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const ERROR_MESSAGES: Record<string, string> = {
  invalid_fields: "El nombre no es válido.",
  same_name: "El nombre nuevo es igual al actual.",
  not_found: "Ese tag ya no existe. Recarga la página.",
  parent_not_found: "El tag padre no existe.",
  parent_invalid:
    "No se puede anidar ahí: la jerarquía es de dos niveles y un tag con hijos no puede colgar de otro.",
  portfolio_unavailable:
    "No se pudo hablar con la base del portafolio. Revisa la configuración.",
};
function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? "Algo ha ido mal. Inténtalo de nuevo.";
}
function showToast(text: string, kind: "error" | "ok" = "error") {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

const usageMap = computed(() => new Map(usage.value.map((u) => [u.name, u.count])));
const tagNames = computed(() => new Set(tags.value.map((t) => t.name)));

function usageOf(name: string): number {
  return usageMap.value.get(name) ?? 0;
}

// Raíces: sin parent, o con un parent que ya no existe como tag (colgado).
const roots = computed(() =>
  [...tags.value]
    .filter((t) => t.parent === null || !tagNames.value.has(t.parent))
    .sort((a, b) => a.name.localeCompare(b.name)),
);
function childrenOf(name: string): Tag[] {
  return tags.value
    .filter((t) => t.parent !== null && tagNames.value.has(t.parent) && t.parent === name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
function hasChildren(name: string): boolean {
  return tags.value.some((t) => t.parent === name);
}

// Salud del vocabulario.
const orphans = computed(() =>
  usage.value
    .filter((u) => !tagNames.value.has(u.name))
    .sort((a, b) => b.count - a.count),
);
const unused = computed(() =>
  tags.value
    .filter((t) => usageOf(t.name) === 0)
    .sort((a, b) => a.name.localeCompare(b.name)),
);

// Opciones de "raíz" para anidar (padres válidos: raíces distintas de sí misma).
const rootOptions = computed(() =>
  roots.value.map((t) => t.name),
);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await fetch("/api/portfolio/tags");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "unknown");
    tags.value = data.tags;
    usage.value = data.usage;
  } catch (err) {
    loadError.value = messageFor(err instanceof Error ? err.message : "unknown");
  } finally {
    loading.value = false;
  }
}

async function createTag() {
  const name = newName.value.trim().toLowerCase();
  if (!name) return;
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent: newParent.value || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(messageFor(data.error));
      return;
    }
    newName.value = "";
    newParent.value = "";
    await load();
  } catch {
    showToast(messageFor("unknown"));
  }
}

async function adoptOrphan(name: string) {
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(messageFor(data.error));
      return;
    }
    showToast(`«${name}» añadida al vocabulario.`, "ok");
    await load();
  } catch {
    showToast(messageFor("unknown"));
  }
}

async function moveTag(name: string, parent: string | null) {
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(messageFor(data.error));
      return;
    }
    await load();
  } catch {
    showToast(messageFor("unknown"));
  }
}

async function removeTag(name: string) {
  const used = usageOf(name);
  const warn = used
    ? `El tag «${name}» se usa en ${used} imagen${used === 1 ? "" : "es"}. Borrarlo NO cambia esas imágenes: la categoría quedará como huérfana. ¿Continuar?`
    : `¿Borrar el tag «${name}» del vocabulario?`;
  if (!confirm(warn)) return;
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(messageFor(data.error));
      return;
    }
    await load();
  } catch {
    showToast(messageFor("unknown"));
  }
}

// ---- Renombrar / fusionar ----

function openRename(from: string) {
  renameFrom.value = from;
  renameTo.value = from;
  renamePreview.value = null;
}
function closeRename() {
  renameFrom.value = null;
  renameTo.value = "";
  renamePreview.value = null;
}

/** Dry-run: pregunta al servidor cuántas imágenes tocaría, sin aplicar. */
async function previewRename() {
  const from = renameFrom.value;
  const to = renameTo.value.trim().toLowerCase();
  if (!from || !to || to === from) {
    showToast(messageFor("same_name"));
    return;
  }
  renameBusy.value = true;
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, apply: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(messageFor(data.error));
      return;
    }
    renamePreview.value = { affected: data.affected, merged: data.merged };
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    renameBusy.value = false;
  }
}

async function applyRename() {
  const from = renameFrom.value;
  const to = renameTo.value.trim().toLowerCase();
  if (!from || !to) return;
  renameBusy.value = true;
  try {
    const res = await fetch("/api/portfolio/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, apply: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(messageFor(data.error));
      return;
    }
    const verb = data.merged ? "fusionado" : "renombrado";
    showToast(
      `«${from}» ${verb} en «${to}» (${data.affected} imagen${data.affected === 1 ? "" : "es"}).`,
      "ok",
    );
    closeRename();
    await load();
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    renameBusy.value = false;
  }
}

const renameTargetExists = computed(() => {
  const to = renameTo.value.trim().toLowerCase();
  return !!to && to !== renameFrom.value && tagNames.value.has(to);
});

// ---- Normalizar: reasignar a una categoría amplia (raíz) o descartar ----
// Guiado: en vez de escribir el destino, se elige una de las categorías amplias
// (o "eliminar de las imágenes" para el ruido que no encaja en ninguna).
const normFrom = ref<string | null>(null);
const normMode = ref<"merge" | "remove">("merge");
const normTarget = ref("");
const normBusy = ref(false);

/** Raíces distintas de la categoría que se normaliza (posibles destinos). */
const normTargets = computed(() =>
  rootOptions.value.filter((r) => r !== normFrom.value),
);

function openNormalize(name: string) {
  normFrom.value = name;
  normMode.value = "merge";
  normTarget.value = "";
}
function closeNormalize() {
  normFrom.value = null;
  normTarget.value = "";
}

async function applyNormalize() {
  const from = normFrom.value;
  if (!from) return;
  normBusy.value = true;
  try {
    if (normMode.value === "merge") {
      const to = normTarget.value;
      if (!to || to === from) {
        showToast("Elige una categoría general de destino.");
        return;
      }
      const res = await fetch("/api/portfolio/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, apply: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(messageFor(data.error));
        return;
      }
      showToast(
        `«${from}» normalizada en «${to}» (${data.affected} imagen${data.affected === 1 ? "" : "es"}).`,
        "ok",
      );
    } else {
      const res = await fetch("/api/portfolio/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: from, purgeImages: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(messageFor(data.error));
        return;
      }
      showToast(
        `«${from}» eliminada de ${data.purged} imagen${data.purged === 1 ? "" : "es"}.`,
        "ok",
      );
    }
    closeNormalize();
    await load();
  } catch {
    showToast(messageFor("unknown"));
  } finally {
    normBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <p v-if="loading" class="text-neutral-500">Cargando el vocabulario…</p>
  <p
    v-else-if="loadError"
    class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
  >
    {{ loadError }}
  </p>

  <div v-else class="space-y-8">
    <!-- Crear tag -->
    <div class="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-4">
      <div>
        <label class="mb-1 block text-xs font-medium text-neutral-600">
          Nuevo tag
        </label>
        <input
          v-model="newName"
          type="text"
          placeholder="paisaje"
          class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
          @keydown.enter="createTag"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-neutral-600">
          Dentro de (opcional)
        </label>
        <select
          v-model="newParent"
          class="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pink-500 focus:outline-none"
        >
          <option value="">(raíz)</option>
          <option v-for="r in rootOptions" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <button
        :disabled="!newName.trim()"
        class="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        @click="createTag"
      >
        Añadir
      </button>
    </div>

    <!-- Árbol -->
    <section>
      <h2 class="mb-3 text-sm font-semibold text-neutral-700">
        Vocabulario ({{ tags.length }})
      </h2>
      <p
        v-if="tags.length === 0"
        class="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500"
      >
        Todavía no hay tags. Créalos arriba o adopta las categorías en uso de
        más abajo.
      </p>
      <ul v-else class="space-y-1">
        <template v-for="root in roots" :key="root.name">
          <li class="rounded-lg border border-neutral-200 bg-white">
            <div class="flex flex-wrap items-center gap-2 px-3 py-2">
              <span class="font-medium">{{ root.name }}</span>
              <span
                class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500"
                :title="`${usageOf(root.name)} imágenes usan esta categoría`"
              >
                {{ usageOf(root.name) }}
              </span>
              <div class="ml-auto flex items-center gap-1 text-xs">
                <button
                  class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                  @click="openRename(root.name)"
                >
                  Renombrar / fusionar
                </button>
                <button
                  class="rounded px-2 py-1 text-pink-600 hover:bg-pink-50"
                  @click="openNormalize(root.name)"
                >
                  Normalizar
                </button>
                <button
                  class="rounded px-2 py-1 text-red-500 hover:bg-red-50"
                  @click="removeTag(root.name)"
                >
                  Borrar
                </button>
              </div>
            </div>

            <!-- Hijos -->
            <ul
              v-if="childrenOf(root.name).length"
              class="border-t border-neutral-100"
            >
              <li
                v-for="child in childrenOf(root.name)"
                :key="child.name"
                class="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-1.5 pl-8 last:border-b-0"
              >
                <span class="text-neutral-400">↳</span>
                <span class="text-sm">{{ child.name }}</span>
                <span
                  class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500"
                >
                  {{ usageOf(child.name) }}
                </span>
                <div class="ml-auto flex items-center gap-1 text-xs">
                  <button
                    class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                    @click="moveTag(child.name, null)"
                  >
                    A raíz
                  </button>
                  <button
                    class="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                    @click="openRename(child.name)"
                  >
                    Renombrar
                  </button>
                  <button
                    class="rounded px-2 py-1 text-pink-600 hover:bg-pink-50"
                    @click="openNormalize(child.name)"
                  >
                    Normalizar
                  </button>
                  <button
                    class="rounded px-2 py-1 text-red-500 hover:bg-red-50"
                    @click="removeTag(child.name)"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            </ul>

            <!-- Mover a: solo tiene sentido para raíces sin hijos -->
            <div
              v-if="!hasChildren(root.name) && rootOptions.length > 1"
              class="border-t border-neutral-100 px-3 py-1.5 pl-8"
            >
              <label class="text-xs text-neutral-400">
                Anidar dentro de:
                <select
                  class="ml-1 rounded border border-neutral-200 px-1 py-0.5 text-xs"
                  @change="
                    moveTag(
                      root.name,
                      ($event.target as HTMLSelectElement).value || null,
                    )
                  "
                >
                  <option value="">(mantener como raíz)</option>
                  <option
                    v-for="r in rootOptions.filter((n) => n !== root.name)"
                    :key="r"
                    :value="r"
                  >
                    {{ r }}
                  </option>
                </select>
              </label>
            </div>
          </li>
        </template>
      </ul>
    </section>

    <!-- Categorías huérfanas (en uso, sin tag) -->
    <section v-if="orphans.length">
      <h2 class="mb-1 text-sm font-semibold text-neutral-700">
        Categorías sin tag ({{ orphans.length }})
      </h2>
      <p class="mb-3 text-xs text-neutral-500">
        Se usan en imágenes pero no están en el vocabulario. Adóptalas como tag
        o fusiónalas en uno existente.
      </p>
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="o in orphans"
          :key="o.name"
          class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm"
        >
          <span>{{ o.name }}</span>
          <span class="text-xs text-amber-700">({{ o.count }})</span>
          <button
            class="text-xs font-medium text-amber-800 hover:underline"
            @click="adoptOrphan(o.name)"
          >
            Adoptar
          </button>
          <button
            class="text-xs text-neutral-500 hover:underline"
            @click="openRename(o.name)"
          >
            Fusionar
          </button>
          <button
            class="text-xs font-medium text-pink-600 hover:underline"
            @click="openNormalize(o.name)"
          >
            Normalizar
          </button>
        </li>
      </ul>
    </section>

    <!-- Tags sin uso -->
    <section v-if="unused.length">
      <h2 class="mb-3 text-sm font-semibold text-neutral-700">
        Tags sin uso ({{ unused.length }})
      </h2>
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="t in unused"
          :key="t.name"
          class="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-500"
        >
          <span>{{ t.name }}</span>
          <button
            class="text-xs text-red-500 hover:underline"
            @click="removeTag(t.name)"
          >
            Borrar
          </button>
        </li>
      </ul>
    </section>

    <!-- Modal normalizar -->
    <div
      v-if="normFrom"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeNormalize"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 class="mb-1 font-semibold">Normalizar «{{ normFrom }}»</h2>
        <p class="mb-3 text-xs text-neutral-500">
          Se usa en <strong>{{ usageOf(normFrom) }}</strong>
          imagen{{ usageOf(normFrom) === 1 ? "" : "es" }}. Reasígnala a una
          categoría general, o elimínala de las imágenes si es ruido que no
          encaja en ninguna.
        </p>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="normMode" type="radio" value="merge" class="accent-pink-600" />
          Reasignar a una categoría general
        </label>
        <select
          v-model="normTarget"
          :disabled="normMode !== 'merge'"
          class="mt-1 mb-3 ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none disabled:opacity-50"
        >
          <option value="">Elige una categoría general…</option>
          <option v-for="r in normTargets" :key="r" :value="r">{{ r }}</option>
        </select>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="normMode" type="radio" value="remove" class="accent-pink-600" />
          Eliminar de las imágenes (descartar)
        </label>

        <div class="mt-5 flex justify-end gap-2">
          <button
            :disabled="normBusy"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="closeNormalize"
          >
            Cancelar
          </button>
          <button
            :disabled="normBusy || (normMode === 'merge' && !normTarget)"
            class="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            :class="normMode === 'remove' ? 'bg-red-600 hover:bg-red-500' : 'bg-pink-600 hover:bg-pink-500'"
            @click="applyNormalize"
          >
            {{
              normBusy
                ? "Aplicando…"
                : normMode === "remove"
                  ? "Eliminar"
                  : "Normalizar"
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- Modal renombrar / fusionar -->
    <div
      v-if="renameFrom"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeRename"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 class="mb-1 font-semibold">Renombrar o fusionar</h2>
        <p class="mb-3 text-xs text-neutral-500">
          Cambiar «{{ renameFrom }}» actualiza todas las imágenes que la usan.
          Si el nombre nuevo ya existe, se fusionan.
        </p>
        <input
          v-model="renameTo"
          type="text"
          class="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-pink-500 focus:outline-none"
          @input="renamePreview = null"
        />
        <p
          v-if="renameTargetExists"
          class="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700"
        >
          «{{ renameTo.trim().toLowerCase() }}» ya existe: será una
          <strong>fusión</strong>.
        </p>

        <!-- Previsualización del impacto -->
        <p
          v-if="renamePreview"
          class="mt-3 rounded-lg bg-neutral-100 px-3 py-2 text-sm"
        >
          Afecta a
          <strong>{{ renamePreview.affected }}</strong>
          imagen{{ renamePreview.affected === 1 ? "" : "es" }}{{
            renamePreview.merged ? " y fusiona con un tag existente" : ""
          }}.
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            :disabled="renameBusy"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
            @click="closeRename"
          >
            Cancelar
          </button>
          <button
            v-if="!renamePreview"
            :disabled="renameBusy || !renameTo.trim()"
            class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            @click="previewRename"
          >
            {{ renameBusy ? "Calculando…" : "Previsualizar" }}
          </button>
          <button
            v-else
            :disabled="renameBusy"
            class="rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
            @click="applyRename"
          >
            {{ renameBusy ? "Aplicando…" : "Confirmar" }}
          </button>
        </div>
      </div>
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
