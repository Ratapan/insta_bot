<script setup lang="ts">
import { computed, ref } from "vue";
import { authClient } from "../../lib/auth-client";

const props = defineProps<{
  mode: "login" | "register";
}>();

const name = ref("");
const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

const isRegister = computed(() => props.mode === "register");

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email o contraseña incorrectos.",
  USER_ALREADY_EXISTS: "Ya existe una cuenta con ese email.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
  INVALID_EMAIL: "El email no es válido.",
};

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    const result = isRegister.value
      ? await authClient.signUp.email({
          name: name.value.trim(),
          email: email.value.trim(),
          password: password.value,
        })
      : await authClient.signIn.email({
          email: email.value.trim(),
          password: password.value,
        });

    if (result.error) {
      error.value =
        ERROR_MESSAGES[result.error.code ?? ""] ??
        "Algo ha ido mal. Inténtalo de nuevo.";
      return;
    }
    window.location.href = "/app";
  } catch {
    error.value = "No se pudo conectar con el servidor.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <label v-if="isRegister" class="flex flex-col gap-1">
      <span class="text-sm font-medium">Nombre</span>
      <input
        v-model="name"
        type="text"
        required
        autocomplete="name"
        placeholder="Tu nombre"
        class="rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium">Email</span>
      <input
        v-model="email"
        type="email"
        required
        autocomplete="email"
        placeholder="tu@email.com"
        class="rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
      />
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium">Contraseña</span>
      <input
        v-model="password"
        type="password"
        required
        minlength="8"
        :autocomplete="isRegister ? 'new-password' : 'current-password'"
        placeholder="Mínimo 8 caracteres"
        class="rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
      />
    </label>

    <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </p>

    <button
      type="submit"
      :disabled="loading"
      class="rounded-lg bg-neutral-900 px-4 py-2.5 font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
    >
      {{ loading ? "Un momento…" : isRegister ? "Crear cuenta" : "Entrar" }}
    </button>
  </form>
</template>
