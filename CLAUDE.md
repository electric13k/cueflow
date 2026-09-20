# Project rules for AI coding agents

Auto-scaffolded by tokenade on first MCP session. Safe to edit; the tokenade block below is identified by the HTML marker and will be updated in-place on future tokenade upgrades.

## What this is

CueFlow: a browser cue board and soundboard for live productions. React 19 + Vite 6 + Tailwind 4 + HeroUI 3, TypeScript, Supabase for auth/database/storage, deployed to Cloudflare Pages.

The app is **local-first**. Sounds and sequences live in this browser and an account is optional; the cloud is what makes them follow you to another device and to the crew. Code that assumes an account is a bug.

## Commands

```bash
npm run dev            # Vite dev server on 5173
npm run build          # tsc --noEmit, then vite build into dist/ (tsc alone takes >2 min)
npm test               # vitest run, 380+ tests across 44 files
npm run preview        # serve the built dist/ on 4173
```

Playwright checks that encode regressions this project has actually had, worth running after UI work:
`check:mobile-scroll`, `check:menu-motion`, `check:alerts-consent`, `check:script-find-mode`, `check:sidebar-typography`.

## Deploy

**Pushing to `master` is the deploy.** The Pages project is connected to `electric13k/cueflow` on GitHub: production branch `master`, build command `npm run build`, output directory `dist`. Cloudflare runs the build itself, and `dist/` is gitignored, so there is nothing to upload by hand. Pushing any other branch produces a preview deployment, not production.

So `npm run build` passing locally is the gate: if `tsc --noEmit` fails, the Cloudflare build fails too and the site silently stays on the previous version.

`master` once sat 23 commits behind what was live, which is worth knowing because it means the default branch has been wrong before. To check what is actually live, compare the asset hashes in the deployed `index.html` against local `dist/index.html`.

## Supabase

Project ref `uumbvunbgcbkzoenupay`. The URL and publishable key are hardcoded as fallbacks in `src/lib/store.ts:6-7` so a Pages build with no injected env still works.

Two failure modes that look like application bugs and are not:

- **A paused project.** Free-tier projects pause after inactivity, and then auth, Postgres, Storage and Realtime are all unreachable at once. Symptom: `realtime CHANNEL_ERROR` in a loop and every fetch failing. Restore it in the dashboard; it takes a few minutes to reach `ACTIVE_HEALTHY`.
- **An unapplied migration.** `supabase/migrations/0002_sync_and_shows.sql` was written and committed long before it was ever applied, so the friends list and the waiting room shipped against tables that did not exist. Check before blaming the client:

```sql
select table_name from information_schema.tables where table_schema='public';
select tablename, attnames from pg_publication_tables where pubname='supabase_realtime';
```

An empty `supabase_realtime` publication means `postgres_changes` delivers nothing, no matter how healthy the socket looks. `shows` and `show_roles` are published with explicit column lists that exclude `shows.password` and `show_roles.code`; those are join keys, and publishing them whole hands every subscriber another role's entry code.

## Taking a show off this machine

A show leaves the app as a `.cueflow` file: an ordinary zip holding `manifest.json`, `show.json` and
`assets/<sha256>.<ext>`. `src/lib/showPack.ts` writes and reads it; `src/lib/zip.ts` is the zip
writer and reader, no dependency. The manifest carries the **role** the copy was cut for, so the
device that opens it lands in that job with nothing typed.

```bash
node scripts/bake-show.mjs my-show.cueflow   # copy it into src-tauri/resources/, rename the app
npm run tauri build                          # an installer that IS that show
node scripts/bake-show.mjs --reset           # put tauri.conf.json back, byte for byte
```

`scripts/bake-show.mjs` has its **own** zip reader, in Node, sharing no code with the app's. That
pair is what `scripts/bake-show.test.ts` exists to stop drifting. The `custom-app` workflow does the
same thing in CI from a link to the file.

Three content-addressed stores, all naming a file by the SHA-256 of its bytes, so the same sound is
one file across all of them: Supabase Storage (`contentPath` in `compress.ts`), the native disk
(`src-tauri/src/store.rs`), and the browser (`src/lib/webStore.ts`).

## The browser's asset store

`webStore.ts` holds locally imported media in Cache Storage under `cueflow-assets-v1`, served back
by `public/sw.js` at `/cf-asset/<hash>.<ext>` so `track.url` stays a plain string every `<audio>`
already understands, Range requests included. Two things to know:

- It is **not** `cueflow-media-v1`. That one mirrors files that also exist in the cloud and
  `forgetOffline()` empties it. `cueflow-assets-v1` is often the only copy there is.
- The bucket name and the path prefix are duplicated in `public/sw.js`, which is static and cannot
  import anything. `webStore.test.ts` reads that file and fails if they drift.
- No controlling service worker means no stable URL to serve, so `keepAssetWeb` returns null and
  the caller falls back rather than minting a URL that 404s tomorrow. Service workers are off in
  `vite dev`, so test this against `npm run preview` on localhost.

## Conventions

- **Type scale lives in `@theme` in `src/styles.css`.** Use the named steps (`text-micro` / `label` / `body` / `lead` / `heading` / `title` / `banner` / `display` / `marquee`), never an arbitrary `text-[13px]`. 12px is the floor: operators read this in a dark room.
- **Three weights with jobs**: `font-bold` for display type, `font-semibold` for titles in the app, `font-medium` for control labels. `font-black` is not used.
- **Four fonts with jobs**, set in `@theme`: display for headings, control for buttons, mono for scripts and cue numbers, sans for reading.
- Levels and gains are **vertical** sliders (`orientation="vertical"` on the `ui.tsx` wrapper); timelines and scrubs stay horizontal.
- Comments explain **why**, not what, and name the bug that motivated the code. Match that voice.

## Gotchas

- `switchProject` reloads the page on purpose. Storage keys are per project (`scopedKey` in `src/lib/projects.ts`) and the library, deck, sequences and shows are all read at mount, so a soft navigation leaves one project's deck on another project's library.
- `hydrateCloud` returns three things, not two: a copy, `null` for "no account", `false` for "the read failed". Collapsing the last two is what told signed-in operators to sign in.
- `src/pages/Studio.tsx` is ~2270 lines with 12 components in it. Extract before adding.
- There is a service worker (`public/sw.js`). A bad cache entry survives redeploys, because the browser stops asking.
- HeroUI's `onPress` does not fire for the browser pane's synthetic clicks. To drive a button from
  `javascript_tool`, dispatch the whole pointer sequence (`pointerdown`, `mousedown`, `pointerup`,
  `mouseup`, `click`) with `pointerId` and `pointerType` set.
- `npm test` includes `scripts/bake-show.test.ts`, which writes to `src-tauri/tauri.conf.json` and
  restores it. Nothing else may touch that file during a test run.



<!-- tokenade-scaffold -->
## Project rules
Read `AGENTS.md` in this directory before you start — it carries this project's rules for working with the `tokenade` CLI. They are written once, there, so this agent does not load the same rules twice.
<!-- /tokenade-scaffold -->