<script setup lang="ts">
import { ref } from "vue";
import { authClient } from "../../lib/auth-client";

const loading = ref(false);

async function logout() {
  loading.value = true;
  await authClient.signOut();
  window.location.href = "/login";
}
</script>

<template>
  <button
    :disabled="loading"
    class="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    @click="logout"
  >
    {{ loading ? "Cerrando sesión…" : "Cerrar sesión" }}
  </button>
</template>
