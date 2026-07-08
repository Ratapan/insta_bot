/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Usuario propietario fijo (app de un solo usuario); null sin sesión. */
    user: { id: string; email: string; name: string } | null;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_BASE_URL: string;
  readonly APP_PASSWORD: string;
  readonly SESSION_SECRET: string;
  readonly DATABASE_PATH?: string;
  readonly ANTHROPIC_API_KEY: string;
  readonly META_APP_ID: string;
  readonly META_APP_SECRET: string;
  readonly META_REDIRECT_URI: string;
  readonly R2_ACCOUNT_ID: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly R2_BUCKET: string;
  // --- Gestor del portafolio (javiersabando.lat) ---
  readonly PORTFOLIO_MONGODB_URI?: string;
  readonly PORTFOLIO_R2_ACCOUNT_ID?: string;
  readonly PORTFOLIO_R2_ACCESS_KEY_ID?: string;
  readonly PORTFOLIO_R2_SECRET_ACCESS_KEY?: string;
  readonly PORTFOLIO_R2_BUCKET?: string;
  readonly PORTFOLIO_ASSETS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
