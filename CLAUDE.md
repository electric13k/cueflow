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

**The live site is whatever was last pushed to `dist/`, not necessarily what is on a branch.** Deploys have been run by hand with `npx wrangler pages deploy` from the working tree, which is how `master` ended up 23 commits behind production for two weeks. `wrangler.toml` sets `pages_build_output_dir = "dist"`.

Rule: **build, deploy, and push in the same sitting.** A hand deploy that is not followed by a push leaves the default branch lying about what users are running, and any dashboard-triggered rebuild silently reverts the site.

To check what is actually live, compare the asset hashes in the deployed `index.html` against local `dist/index.html`.

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

<!-- tokenade-scaffold -->
## Explore code with the `tokenade` CLI (cheaper than reading whole files)
Use these only when you don't yet know where code lives — if you know the path, open it directly:
`tokenade map` (repo structure) · `skeleton <file…>` (signatures) · `query <symbol…>` (locate a symbol) · `impact <file…>` (dependents) · `semantic "<query>"` (search by meaning). They take MANY targets per call (`tokenade skeleton a.rs b.rs c.rs`) — batch in ONE turn.

## Compute over data with `tokenade exec`
`tokenade exec --lang python --script '<code>'` (also sh/node/ruby/awk/jq/perl) runs in a sandbox and returns ONLY its stdout. Use it to COMPUTE over data — filter/aggregate a large or structured output, pull facts across SEVERAL files, or apply one mechanical edit across many files (migration, find-replace) — in ONE script, not one command per item. It is NOT a file reader: to read content, use the parallel reads above, not `exec`. Keep scripts SHORT (aim ≤ ~20 lines): exec is for throwaway one-shot computation, not for code you will edit and iterate on — every script char is billed as output, and a long script usually means a simpler command (or a real file you Write once and run) does it cheaper. Long or quote-heavy script? `--script-file <path>` (or `--script -` on stdin) avoids shell quoting entirely.

## Commands
If you do not have hooks (i.e. you are not Claude Code or Gemini CLI), use `tokenade wrap '<cmd>'` to wrap all your commands. If there is an opportunity for compacting noisy output, tokenade will find it — and you will waste fewer tokens. On Windows, if your commands are PowerShell or cmd (not bash), add `--shell powershell` or `--shell cmd` so they run under the right interpreter: `tokenade wrap --shell powershell '<cmd>'`.
Call binaries by their PATH name, not an absolute path (`git`, not `/usr/bin/git`) — an absolute path bypasses tokenade's hook and PATH shim, so that command's output isn't compacted.

## Keep output lean
Keep prose terse and code minimal — every token you write is billed as output.
- **Prose:** answer directly — no preamble, recap, tool-call narration, summary, or emoji. Drop articles, filler (*just/really/basically/simply*) and hedging; fragments fine; short word over long.
- **Output:** don't paste long raw output — quote the shortest decisive line. No decorative tables.
- **Code:** write the least that works; reuse before adding (`query` / `skeleton` / `impact`, stdlib, platform feature — YAGNI).
- **Verbatim:** keep code, identifiers, API/CLI names and error strings exact — never abbreviate or paraphrase. Keep the user's language.
- **Correctness first:** fix root causes not symptoms, don't downgrade the algorithm, don't guess APIs/flags/versions — verify.
- **Full prose where terseness could mislead:** security/data-loss warnings, irreversible-action confirmations, multi-step sequences.
<!-- /tokenade-scaffold -->
