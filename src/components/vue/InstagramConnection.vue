<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  connected: boolean;
  username: string | null;
  expiresSoon: boolean;
}>();

const loading = ref(false);

function connect() {
  loading.value = true;
  window.location.href = "/api/instagram/connect";
}

async function disconnect() {
  if (!confirm("¿Seguro que quieres desconectar tu cuenta de Instagram?")) {
    return;
  }
  loading.value = true;
  try {
    await fetch("/api/instagram/disconnect", { method: "POST" });
    window.location.reload();
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <template v-if="connected">
      <p class="text-sm text-neutral-600">
        Conectado como
        <span class="font-medium text-neutral-900">@{{ username ?? "?" }}</span>
      </p>
      <p
        v-if="expiresSoon"
        class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        Tu acceso a Instagram caduca pronto. Vuelve a conectar la cuenta para
        renovarlo.
      </p>
      <div class="mt-4 flex gap-3">
        <button
          :disabled="loading"
          class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50"
          @click="connect"
        >
          Reconectar
        </button>
        <button
          :disabled="loading"
          class="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          @click="disconnect"
        >
          Desconectar
        </button>
      </div>
    </template>
    <template v-else>
      <p class="text-sm text-neutral-600">
        Conecta tu cuenta de Instagram Business para leer tus publicaciones y
        publicar desde aquí.
      </p>
      <button
        :disabled="loading"
        class="mt-4 rounded-lg bg-pink-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-pink-500 disabled:opacity-50"
        @click="connect"
      >
        {{ loading ? "Redirigiendo…" : "Conectar Instagram" }}
      </button>
    </template>
  </div>
</template>
