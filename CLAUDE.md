# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InstaCaptions: a single-user web app that generates Instagram captions with Claude and publishes them directly, and doubles as the content admin for the owner's portfolio site (portfolio_2025). Astro 5 (SSR), Vue 3 islands, Tailwind CSS 4, Drizzle ORM + SQLite, Cloudflare R2. Auth is a single password (`APP_PASSWORD`) — no accounts or registration. UI copy and code comments are in Spanish — match that when editing.

The README.md is the authoritative setup guide (Meta app config, R2 config, Railway deploy). Read it before touching the Instagram OAuth or storage flows.

## Commands

Package manager is **pnpm**. Native deps (`better-sqlite3`, `sharp`, `esbuild`, `exifreader`, `@tailwindcss/oxide`) must be listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml` or pnpm skips their build scripts and the bindings fail at boot (`Could not locate the bindings file`). After adding one, run `pnpm rebuild <pkg>`.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev server at https://localhost:4321 (self-signed HTTPS) |
| `pnpm build` | Production build to `dist/` |
| `pnpm start` | Run the build (`node ./dist/server/entry.mjs`) |
| `pnpm db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `pnpm db:studio` | Drizzle Studio to inspect the DB |
| `pnpm astro check` | Type-check (`@astrojs/check` + strict tsconfig) |

There is no test suite or linter configured. Type checking via `astro check` is the only automated verification.

## Architecture

**Request lifecycle.** `src/middleware.ts` runs on every request. Auth is single-user: a session cookie derived from `APP_PASSWORD` + `SESSION_SECRET` (`src/lib/session.ts`, same sha256-token pattern as portfolio_2025's admin; constant-time compares; changing the password invalidates the session). `context.locals.user` is always the fixed owner user (`src/lib/ownerUser.ts`: first row of the `user` table, created if the DB is fresh — keeps existing FKs and the `u/{userId}/` storage namespace working). The middleware guards `/app/*` and `/api/*` (redirect to `/login` for pages, `401 JSON` for API); `/api/login` is the only open API route (rate-limited 5/15min per IP). Logout: `POST /api/logout`. **Because the middleware guarantees auth, API routes use `context.locals.user!.id` directly without re-checking.**

**Database is a module side-effect.** Importing `src/lib/db.ts` opens the SQLite file (creating `./data/` if needed), sets WAL, and runs pending migrations from `src/db/migrations` immediately. Migrations apply automatically on every boot (dev and Railway) — there is no separate migrate step.

**Schema lives in one file.** `src/db/schema.ts` holds the app tables (`user`, `instagramAccount`, `scheduledPost`, `generationLog`) plus `session`/`account`/`verification`, which are legacy from the removed Better Auth setup — kept to avoid a migration, no longer used. The `user` table now holds a single owner row (see `ownerUser.ts`). After any change here, run `pnpm db:generate` to produce a migration; do not hand-edit migrations. Timestamps are `integer({ mode: "timestamp" })` and booleans `integer({ mode: "boolean" })` to keep the schema portable for a future Postgres migration (see README).

**Three external-service wrappers in `src/lib/`** — keep all third-party calls inside these, API routes orchestrate them:
- `instagram.ts` — **Instagram API con Instagram Login** (not Facebook Login). Graph calls hit `graph.instagram.com/v23.0` via `graphFetch`, which throws `MetaApiError`. **`err.isAuthError` (code 190) means an expired token** → routes return `409 { error: "reconnect" }` and the UI prompts to reconnect. OAuth: authorize at `instagram.com/oauth/authorize` (scopes `instagram_business_basic,instagram_business_content_publish`) → `exchangeCodeForToken` POSTs to `api.instagram.com` and returns `igUserId` directly (no Facebook-page discovery) → `exchangeForLongLivedToken`/`refreshLongLivedToken` hit `graph.instagram.com`. The 60-day token auto-refreshes in the scheduler (`refreshExpiringTokens`, checked every 6h) when it expires within 7 days.
- `claude.ts` — Anthropic SDK (`MODEL = "claude-sonnet-4-6"`, `maxRetries: 3`). `generateCaptions` enforces a strict JSON-only system prompt and **retries once on malformed JSON** (separate from the SDK's network retries). Throws `CaptionGenerationError` with `reason: "parse" | "api"`. Images are normalized to 768px JPEG before sending (Claude bills by pixel dimensions); raw input caps are 8MB from the library and 15MB for IG downloads. `/api/captions/generate` is rate-limited per user (20/hour, in-memory `src/lib/rateLimit.ts`).
- `storage.ts` — Cloudflare R2 via the S3 SDK. **Every key is namespaced under `u/{userId}/`** and every client-supplied path goes through `sanitizeRelPath` (rejects `.`/`..`) — preserve this isolation when adding storage operations. Folders are emulated S3 prefixes with marker objects. Private bucket: previews and Instagram's image fetch both use short-lived presigned URLs.

**Portfolio manager.** `/app/portfolio` + `/api/portfolio/*` manage the images of the separate portfolio site (javiersabando.lat / portfolio_2025 repo). Single-user app: any valid session is the owner, so these routes are covered by the normal auth guard. Three dedicated lib modules, deliberately separate from the Instagram ones:
- `portfolioDb.ts` — native `mongodb` driver (lazy connect on first use, NOT at import) against the portfolio's Mongo (`PORTFOLIO_MONGODB_URI`), collection `images`. The doc shape lives in `portfolioSchema.ts` (Zod, source of truth of the contract with `portfolio_2025/server/models/Image.ts` — change both sides in the same change). `upsertImage` validates fields against the schema and enforces the invariants no route can skip: `category` derived (always `categories[0]`) and inserts with `visible: false` (review rule). Mongoose isn't used here, so every upsert sets `updatedAt` in `$set` and `createdAt` + defaults in `$setOnInsert` manually.
- `portfolioStorage.ts` — second S3 client for the portfolio's PUBLIC R2 bucket (`PORTFOLIO_R2_*` env vars). Global keys + public URLs (`publicUrl()`/`keyFromPublicUrl()` against `PORTFOLIO_ASSETS_BASE_URL`), unlike `storage.ts` which enforces `u/{userId}/` + presigned URLs. Never mix the two.
- `portfolioImage.ts` — `extractExif()` (exifreader, must run on the ORIGINAL buffer: sharp strips metadata) and `toWebp()` (≤2560px, q80).
Pipeline: upload (`api/portfolio/upload.ts`: EXIF → WebP → PutObject) → generate (`api/portfolio/generate.ts` → `generatePortfolioMetadata` in `claude.ts`, bilingual caption/footer + categories, existing Mongo categories injected as preferred vocabulary, logged to `generationLog` with `source: "portfolio_image"`) → save (`api/portfolio/image.ts` upsert by unique `url`; first save defaults `visible: false` so nothing goes live unreviewed). UI: `PortfolioManager.vue` (browser + upload wizard) and `PortfolioImageForm.vue` (metadata editor).

Review queue (`/app/portfolio/revisar`, `PortfolioTriage.vue`): keyboard-first curation over the whole `images` collection (Mongo only — works without `PORTFOLIO_R2_*`). `GET api/portfolio/review` returns ALL docs sorted by `url` (client groups by session, derived from the `blog/images/{session}/` key prefix until the `session` field is backfilled); edits go through `PATCH api/portfolio/image` → `updateImageFields` (partial update of an EXISTING doc; 404 if missing — a PATCH never creates stubs, unlike the PUT upsert). Optimistic UI: apply → PATCH → revert only the sent fields on error. Two modes over the same frozen queue: "uno a uno" (keyboard) and "cuadrícula" (multi-select with shift-ranges + bulk visible/portfolio/stars). A *series* (diptych/triptych) is a shared `crypto.randomUUID()` + `order` created from the grid selection; the series panel drag-reorders, propagates the first image's footer to the rest, and undoes (`series: null`).

Sessions (`sessions` collection in the portfolio's Mongo, insta_bot-only — portfolio_2025 never reads it): one doc per shoot (`{ session, context, createdAt, updatedAt }`), the `context` feeds AI generation. `GET/PUT api/portfolio/sessions` → `listSessions`/`upsertSession`. Session names are R2 key segments, validated by `sessionNameSchema` (`/^[\w-]+$/`). The "Subir sesión" wizard in `PortfolioManager.vue` uploads a whole shoot to `blog/images/{session}/`: saves the session context, then per photo upload (EXIF→WebP→R2) + PUT of the image doc with `session` + EXIF (inserts land `visible: false` as always).

**Two core flows** (the app's reason to exist):
- *Flow A — existing posts* (`source: "existing_post"`): read recent IG media, generate captions, copy to clipboard. Instagram's API cannot edit published captions, so the UI links out to paste manually.
- *Flow B — publish* (`source: "new_post"`): upload/pick an image → generate → publish. `api/instagram/publish.ts` creates a media container, then **polls `getContainerStatus` (up to 20×1.5s) until `FINISHED`** before calling publish — Instagram processes images asynchronously.

Every generation is recorded in `generationLog` (source, context, tone, options, chosen index) to iterate on the prompt later.

**Frontend pattern.** `.astro` pages under `src/pages/app/` are thin shells that render Vue islands with `client:load`. The Vue components (`src/components/vue/`) are self-contained: they fetch their own data from `/api/*` endpoints rather than receiving server props. `src/lib/tones.ts` is intentionally server-dependency-free so both the API and Vue components can import the `TONES` list.

## Conventions

- API routes return JSON via a local `json(body, status)` helper and use **string error codes** (`reconnect`, `not_connected`, `claude_unavailable`, `container_failed`, …) that the Vue layer maps to Spanish messages. Follow this instead of inventing prose errors server-side.
- All env access goes through `import.meta.env.*` (Astro), declared in `src/env.d.ts` — add new vars there and to `.env.example`.
- IDs are `crypto.randomUUID()`; timestamps are JS `Date` (Drizzle handles the integer conversion).
