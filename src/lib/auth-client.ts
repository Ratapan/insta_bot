import { createAuthClient } from "better-auth/client";

// Cliente para los componentes Vue (mismo origen, sin baseURL explícita).
export const authClient = createAuthClient();
