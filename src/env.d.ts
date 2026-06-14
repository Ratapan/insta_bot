/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("better-auth").User | null;
    session: import("better-auth").Session | null;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_BASE_URL: string;
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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
