<script setup lang="ts">
import { ref } from "vue";

interface CaptionOption {
  caption: string;
  style: string;
}

const props = defineProps<{
  options: CaptionOption[];
  logId: string;
  /** 'copy': botón de copiar (Flujo A). 'select': elegir para publicar (Flujo B). */
  mode: "copy" | "select";
}>();

const emit = defineEmits<{
  select: [index: number];
}>();

const copiedIndex = ref<number | null>(null);

function recordChoice(index: number) {
  // Best-effort: el log no debe bloquear la UX.
  fetch("/api/captions/choose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId: props.logId, chosenIndex: index }),
  }).catch(() => {});
}

async function copy(index: number) {
  await navigator.clipboard.writeText(props.options[index].caption);
  copiedIndex.value = index;
  recordChoice(index);
  setTimeout(() => {
    if (copiedIndex.value === index) copiedIndex.value = null;
  }, 2500);
}

function select(index: number) {
  recordChoice(index);
  emit("select", index);
}
</script>

<template>
  <ul class="flex flex-col gap-3">
    <li
      v-for="(option, i) in options"
      :key="i"
      class="rounded-xl border border-neutral-200 bg-white p-4"
    >
      <p
        v-if="option.style"
        class="mb-2 text-xs font-medium uppercase tracking-wide text-pink-600"
      >
        {{ option.style }}
      </p>
      <p class="whitespace-pre-wrap text-sm">{{ option.caption }}</p>
      <div class="mt-3">
        <button
          v-if="mode === 'copy'"
          class="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          @click="copy(i)"
        >
          {{ copiedIndex === i ? "¡Copiado!" : "Copiar" }}
        </button>
        <button
          v-else
          class="rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500"
          @click="select(i)"
        >
          Usar este caption
        </button>
      </div>
    </li>
  </ul>
</template>
