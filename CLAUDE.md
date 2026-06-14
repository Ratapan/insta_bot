# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InstaCaptions: a multi-user web app that generates Instagram captions with Claude and publishes them directly. Astro 5 (SSR), Vue 3 islands, Tailwind CSS 4, Better Auth, Drizzle ORM + SQLite, Cloudflare R2. UI copy and code comments are in Spanish — match that when editing.

The README.md is the authoritative setup guide (Meta app config, R2 config, Railway deploy). Read it before touching the Instagram OAuth or storage flows.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:4321 |
| `npm run build` | Production build to `dist/` |
| `npm start` | Run the build (`node ./dist/server/entry.mjs`) |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:studio` | Drizzle Studio to inspect the DB |
| `npx astro check` | Type-check (`@astrojs/check` + strict tsconfig) |

There is no test suite or linter configured. Type checking via `astro check` is the only automated verification.

## Architecture

**Request lifecycle.** `src/middleware.ts` runs on every request: it resolves the Better Auth session and puts `user`/`session` on `context.locals` (typed in `src/env.d.ts`). It guards `/app/*` and `/api/*` (redirect to `/login` for pages, `401 JSON` for API), and bounces logged-in users away from `/login` and `/register`. `/api/auth/*` is skipped — Better Auth owns it via the catch-all `src/pages/api/auth/[...all].ts`. **Because the middleware guarantees auth, API routes use `context.locals.user!.id` directly without re-checking.**

**Database is a module side-effect.** Importing `src/lib/db.ts` opens the SQLite file (creating `./data/` if needed), sets WAL, and runs pending migrations from `src/db/migrations` immediately. Migrations apply automatically on every boot (dev and Railway) — there is no separate migrate step. `src/lib/auth.ts` imports `db` and wires Better Auth through the Drizzle adapter.

**Schema lives in one file.** `src/db/schema.ts` holds both Better Auth's tables (`user`, `session`, `account`, `verification` — names must match what Better Auth expects) and app tables (`instagramAccount`, `generationLog`). After any change here, run `npm run db:generate` to produce a migration; do not hand-edit migrations. Timestamps are `integer({ mode: "timestamp" })` and booleans `integer({ mode: "boolean" })` to keep the schema portable for a future Postgres migration (see README).

**Three external-service wrappers in `src/lib/`** — keep all third-party calls inside these, API routes orchestrate them:
- `instagram.ts` — **Instagram API con Instagram Login** (not Facebook Login). Graph calls hit `graph.instagram.com/v23.0` via `graphFetch`, which throws `MetaApiError`. **`err.isAuthError` (code 190) means an expired token** → routes return `409 { error: "reconnect" }` and the UI prompts to reconnect. OAuth: authorize at `instagram.com/oauth/authorize` (scopes `instagram_business_basic,instagram_business_content_publish`) → `exchangeCodeForToken` POSTs to `api.instagram.com` and returns `igUserId` directly (no Facebook-page discovery) → `exchangeForLongLivedToken`/`refreshLongLivedToken` hit `graph.instagram.com`. The 60-day token auto-refreshes when `settings.astro` loads and it expires within 7 days.
- `claude.ts` — Anthropic SDK (`MODEL = "claude-sonnet-4-6"`, `maxRetries: 3`). `generateCaptions` enforces a strict JSON-only system prompt and **retries once on malformed JSON** (separate from the SDK's network retries). Throws `CaptionGenerationError` with `reason: "parse" | "api"`. Image input is capped at 5MB (Claude's limit).
- `storage.ts` — Cloudflare R2 via the S3 SDK. **Every key is namespaced under `u/{userId}/`** and every client-supplied path goes through `sanitizeRelPath` (rejects `.`/`..`) — preserve this isolation when adding storage operations. Folders are emulated S3 prefixes with marker objects. Private bucket: previews and Instagram's image fetch both use short-lived presigned URLs.

**Two core flows** (the app's reason to exist):
- *Flow A — existing posts* (`source: "existing_post"`): read recent IG media, generate captions, copy to clipboard. Instagram's API cannot edit published captions, so the UI links out to paste manually.
- *Flow B — publish* (`source: "new_post"`): upload/pick an image → generate → publish. `api/instagram/publish.ts` creates a media container, then **polls `getContainerStatus` (up to 20×1.5s) until `FINISHED`** before calling publish — Instagram processes images asynchronously.

Every generation is recorded in `generationLog` (source, context, tone, options, chosen index) to iterate on the prompt later.

**Frontend pattern.** `.astro` pages under `src/pages/app/` are thin shells that render Vue islands with `client:load`. The Vue components (`src/components/vue/`) are self-contained: they fetch their own data from `/api/*` endpoints rather than receiving server props. `src/lib/tones.ts` is intentionally server-dependency-free so both the API and Vue components can import the `TONES` list.

## Conventions

- API routes return JSON via a local `json(body, status)` helper and use **string error codes** (`reconnect`, `not_connected`, `claude_unavailable`, `container_failed`, …) that the Vue layer maps to Spanish messages. Follow this instead of inventing prose errors server-side.
- All env access goes through `import.meta.env.*` (Astro), declared in `src/env.d.ts` — add new vars there and to `.env.example`.
- IDs are `crypto.randomUUID()`; timestamps are JS `Date` (Drizzle handles the integer conversion).
