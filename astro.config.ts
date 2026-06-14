import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// El dev server se sirve por HTTPS (certificado autofirmado) porque Instagram
// exige redirect URIs https, incluso en localhost. En producción el HTTPS lo
// termina Railway, así que el plugin solo se activa en `astro dev`.
const isDev = process.env.NODE_ENV !== "production";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue()],
  vite: {
    plugins: [tailwindcss(), ...(isDev ? [basicSsl()] : [])],
  },
});
