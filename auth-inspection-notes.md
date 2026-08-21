# Cueflow authentication inspection notes

These notes preserve external inspection findings for the current auth audit.

## Supabase project

Supabase project name: cueflow. Project reference: `uumbvunbgcbkzoenupay`. Status: ACTIVE_HEALTHY. Region: us-east-1. Project URL host: `uumbvunbgcbkzoenupay.supabase.co`.

## Supabase schema

The public schema includes `profiles`, `tracks`, `sequences`, `sequence_items`, `projects`, `project_members`, `shows`, `show_roles`, `show_members`, `editor_sessions`, and `retention_notices`. `profiles` has zero rows at inspection time. The profiles table has a unique username field and an id foreign key to `auth.users`.

## Edge Functions

The `signin` Edge Function exists and is ACTIVE with `verify_jwt: false`. It resolves a username through `profiles`, obtains the corresponding user email with the service key, then calls `signInWithPassword` using the anon key and returns a session. With zero profile rows, username-based sign-in cannot succeed until a signed-in user creates a profile username.

## Recent Supabase logs

Recent logs from `https://uumbvunbgcbkzoenupay.supabase.co` showed successful authenticated requests from `https://cuefloww.vercel.app/`, including `GET /auth/v1/user` with status 200, `GET /rest/v1/profiles` with status 200, and `POST /rest/v1/rpc/touch_last_seen` with status 204. A filtered query for signin and authorize paths returned no rows in the queried window. The first log query failed because the SQL used double-quoted string literals; the corrected query succeeded.

## Production bundle probe

A read-only probe against `https://cueflow.pages.dev` found one JavaScript asset but did not find a bundled Supabase URL or publishable key. This suggests the Cloudflare Pages build may not have the required `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables, which would make `supabase` null in the deployed client and explain a non-working sign-in flow on pages.dev. This must be compared against the Vercel bundle and Cloudflare Pages project environment configuration before changing credentials.

## Relevant source paths

- `src/lib/store.ts`: Supabase client, email sign-in, username sign-in, Google OAuth, auth listener.
- `src/components/AuthButton.tsx`: sign-in modal and Continue with Google button.
- `src/pages/Account.tsx`: identity linking and account state.
- `src/main.tsx`: BrowserRouter routes including `/workspace`, `/account`, and `/studio`.
- `src/components/RequireAuth.tsx`: workspace route gate.

## Current source redirect code

Password sign-up uses `${location.origin}${import.meta.env.BASE_URL}studio`.
Google sign-in uses `${location.origin}${import.meta.env.BASE_URL}workspace`.
Google linking uses `${location.origin}${import.meta.env.BASE_URL}account`.
Password reset uses `${location.origin}${import.meta.env.BASE_URL}account`.

## Cloudflare reference

Cloudflare account/project API work must use the configured Cloudflare connector. The Pages project is named `cueflow`. The current deployment project API path used previously was `/accounts/{account_id}/pages/projects/cueflow`.

## Official documentation sources

- Supabase documentation search tool: configured `supabase` MCP server, `search_docs` operation.
- Cloudflare Pages documentation search tool: configured `cloudflare` MCP server, `docs` operation.
