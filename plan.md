# CueFlow, plan

Written 2026-08-05. Nothing in here has been executed. This is the document to argue with before
any more code gets written.

---

## 1. Context

CueFlow is a cue board that runs in a browser tab. Sound, images, video and slides go in one
library; you drag them into a numbered sequence; one keypress fires the next thing on the list
to a second screen the audience sees. Nothing plays on a timer.

The audience is school and community productions, people running a show off a laptop with a media
player and a slide deck in another window.

**Stack.** React 19 + TypeScript + Vite, Tailwind v4 (CSS-first `@theme`), HeroUI v3 behind a
v2-shaped compat layer at `src/ui.tsx`, framer-motion, lucide icons. Web Audio for sound editing,
Canvas 2D for pictures and slides, `pdfjs-dist` + `mammoth` for script import. Supabase for auth,
Postgres + RLS, storage, edge functions and the realtime channel a show runs on. 19 tests in vitest.

**Where it is deployed.** GitHub Pages (primary, auto on push), Cloudflare Pages (manual upload,
no git provider), Vercel (CLI). Netlify is stale and undiagnosable from this machine.

**What the last few sessions did.** Projects and collaborators, shows with role keys and realtime,
the script reader with keyword pre-alerts, the duplicate-key sync fix, a serif/maroon retheme, a
sidebar, a discovery-based coach, username + OAuth sign-in, a public repo with a real README.

**Why this document exists.** The retheme did not land. The sidebar landed on one route. The
editors are still shallow. The correct response is not another pass of the same backlog, it is to
name what is actually wrong first.

---

## 2. Old features, what already exists and works

Marked ✅ working, ⚠️ exists but thin, ❌ claimed but not really there.

### Library and media
- ✅ Upload audio / image / video; browser-local or Supabase storage.
- ✅ Search Internet Archive, Wikimedia Commons, Openverse.
- ✅ Paste-a-link import through `/api/audio` (SSRF-guarded, 25 MB cap, media types only).
- ✅ Auto-renamer on import, strips URL junk, extensions, dedupes (`src/lib/media.ts`, tested).
- ✅ Myinstants hand-off (link out; their Cloudflare bot check is not bypassed).
- ❌ No YouTube / YouTube Music / Spotify / Apple Music. Permanent. Those catalogues are licensed
  rather than free to redistribute, and the protected ones cannot be extracted without
  circumventing access controls. Documented at `/terms#imports`.

### Editors
- ⚠️ **Audio** (`WaveformEditor.tsx`), waveform render, region select, shift-drag one channel,
  trim, gain, fade, tone (low/mid/high), speed, reverb, mono→stereo, timestamps. No undo stack,
  no zoom, no spectrogram, no non-destructive stack.
- ⚠️ **Image** (`MediaEditor.tsx`, `CropBox.tsx`, `lib/image.ts`), crop, rotate, exposure,
  contrast, temperature, saturation. No curves, no per-channel, no masks, no history.
- ⚠️ **Video**, trim in/out only, no re-encode. `Filmstrip.tsx` for scrubbing.
- ⚠️ **Slides** (`SlideComposer.tsx`), title/body, six themes, font pick. Not a deck editor:
  no multi-slide document, no layouts, no image placement, no per-slide transitions.

### Running the show
- ✅ Sequences: sound numbered `1, 2, 3`, anything the room sees `a, b, c`.
- ✅ Linked cues, one keypress fires a slide and the sound under it.
- ✅ Arm the deck; the frame turns brass; the layout reorders around the deck.
- ✅ Presenter/audience window, black until a visual cue fires.
- ✅ Rebindable keys (`lib/keys.ts`, Settings page).
- ✅ Drag reorder with auto-scroll; grip is the full row height.

### Script
- ✅ Import `.docx` / `.pdf`, keeps the writer's formatting, drops the paper.
- ✅ Keyword watch: amber shortly *before* the line lands, red as it lands. Silent by design.
- ✅ Popup / split / tab reading modes.

### Multi-device
- ✅ Shows: host creates roles, each role has a key, key decides what you see and can do.
- ✅ Show password = collaborator with edit/host rights.
- ✅ One global key namespace, nobody's role code can collide with anyone's show password.
  Enforced in SQL by triggers, all four collision directions tested.
- ✅ Silent flash messages between devices over Supabase Realtime broadcast.
- ✅ Anon join, no account needed, the key is the credential.

### Accounts and projects
- ✅ Email or username sign-in. Username resolves server-side in an edge function so the anon key
  cannot be used to enumerate the user list; wrong username and wrong password give the same answer.
- ⚠️ OAuth (Google) wired but the provider is **not enabled** in the Supabase dashboard, so the
  button errors.
- ✅ Projects with their own library, sequences, script and shows; collaborators by username/email.
- ✅ Account page, Settings page, password change and reset (reset always reports success, no
  enumeration).

### Chrome
- ✅ Coach: one lesson at a time, spotlighted on the real control, fires when you open the thing it
  explains, never returns. Seven lessons.
- ⚠️ Sidebar, **built, but mounted only on `/workspace`.** See mistakes.
- ✅ Public repo, README, GitHub Pages CI.

---

## 3. New features, what this plan adds

### 3.1 The backdrop (the actual complaint)

`src/components/Backdrop.tsx` is a WebGL fragment shader that paints an **opaque** field in
`vec3 cyan = vec3(0.13, 0.83, 0.93)` and `vec3 violet = vec3(0.65, 0.55, 0.98)`, mounted behind
`Page`, `Studio` and `Workspace`, i.e. behind every route. The retheme rewrote the CSS tokens and
never touched it. In dark mode, which is the default, the whole site is still blue.

Replace the shader. Not recolour-by-token, a canvas gets no CSS, so the palette has to be read out
of the document and pushed in as uniforms, the same way the waveform and slide canvases were fixed.

New backdrop: a **house-light wash**, a very slow, very low-contrast vertical falloff in
`--cue-curtain` maroon at the top corner and `--cue-audio` olive at the bottom, dust-grain over the
top, no colour that isn't in the palette. The motion should be slower than you can notice on
purpose; a backdrop that competes with the deck is a bug.

Light mode keeps the CSS body gradient and mounts no canvas, as now.

### 3.2 Liquid glass, a refractive prism, not a blur

Current `.glass` is `backdrop-blur-md` + a tint. That is frosted glass. The ask is refraction:
light bending through a solid transparent object, with an edge that catches and splits it.

Implementation, cheapest rung first:
1. `backdrop-filter: blur() saturate()` stays as the base layer, it is the only way to sample
   what is behind an element without re-rendering it.
2. **Edge refraction** via an inset ring built from two conic gradients offset by a few degrees,
   so the rim carries a faint spectral split (warm on one edge, cool on the other) instead of a
   flat white hairline. This is what reads as "prism".
3. **Specular sweep**, a single narrow highlight, positioned from the pointer via a CSS custom
   property (`--gx`, `--gy` set on pointermove, throttled), so the panel appears to have thickness
   and the light source is where your hand is.
4. `@supports not (backdrop-filter: blur(1px))` falls back to a solid tint. No feature detection
   in JS.
5. `prefers-reduced-motion` freezes the sweep at rest position.

Never on: the deck rows during a live show. Refraction over a moving list is unreadable and the
one screen that must stay legible under stage light is the cue list.

### 3.3 Sidebar everywhere

Promote `Shell` out of `pages/Workspace.tsx` into `components/Shell.tsx` and wrap every
authenticated route: Workspace, Projects, Studio, Script, Settings, Account. Marketing routes
(Home, Features, Tutorial, Credits, Terms, Privacy) keep the plain `Page` chrome, an advert does
not need a file tree.

Sidebar contents stay as designed: Recents, Workspaces (Personal + each project), Join a show,
Settings, Account. Add the current-route highlight and a collapse toggle that persists.

**The top bar gets cut down to seven things and nothing else:**

`logo · Home · Features · Workspace · theme toggle · Sign in · GitHub`

Studio and Tutorial come out of the nav. Studio is reached from Workspace, it is where you work,
not a destination you browse to, and Tutorial is reached from the coach and the footer. Everything
removed still lives in the footer, which already links every route. The nav is for arriving; the
sidebar is for working. Right now it is doing both badly.

> **Superseded 2026-08-09 by Part II §8. The seven-item rule is withdrawn; the rule below is the
> one the code obeys.**
>
> A fixed count could not survive two later decisions. §14 took the theme toggle out of the bar
> altogether, and §8 made one of the remaining items conditional: signed out there is no workspace
> to link to. Held as a count, the rule also had the bar and the Shell contradicting each other in
> the code, `Nav.tsx` gated Workspace on `!inShell` while `Shell.tsx` renders `<Nav inShell />`,
> so the bar was six items inside the Shell and five at 375px, and the plan said seven everywhere.
>
> **The rule is now a shape, not a number:**
>
> `logo · Home · Features · one working destination · account control · GitHub`
>
> The **working destination** is the one place the visitor is entitled to work: **Studio** signed
> out, **Workspace** signed in. Inside the Shell the bar carries **neither**, because the sidebar
> owns them and a link repeated two inches apart is not navigation. Features and GitHub still drop
> below `sm`. So the bar is six items on a wide marketing page, five inside the Shell, four at 375px
> outside it and three at 375px inside it, and that variation is the rule working rather than the
> rule being broken.

### 3.4 Mobile and touch

Today the app is responsive but not *operable* by thumb. Specifically:
- Drag reorder uses pointer events with a grab grip, on a phone that competes with page scroll.
  Needs long-press-to-lift (150 ms), haptic on lift where available, and an explicit
  "reorder mode" toggle so a scroll never becomes a drag.
- The waveform region select needs a two-handle model, not a drag, you cannot place a 5 ms edge
  with a fingertip. Handles with a 44 px hit area, the waveform itself pans.
- Crop box corners likewise.
- The transport bar should dock to the bottom on small screens, thumb-reachable, with the next-cue
  button as the largest target on the page.
- `touch-action` set explicitly everywhere a gesture is claimed, so the browser stops guessing.
- Test at 375×812 and 390×844, both orientations.

### 3.5 The editors, deepened

Reference behaviour from four open-source tools. **No code is copied.** Audacity is GPL-2,
darktable and Krita are GPL-3; a web app ships its JavaScript, which counts as distribution, so
copying any of it would relicense CueFlow. The debt is behavioural and is credited by name on
`/credits` and in the README. OpenCut and pptWeb are permissive but get the same treatment for
consistency.

| Tool | What to take | What to build |
|---|---|---|
| **Audacity** | Effect dialogs preview before they commit; destructive edits stack undo; envelope tool for gain over time | Undo/redo stack in the audio editor, live preview on every effect, drag-a-gain-envelope |
| **darktable** | Module order is fixed and meaningful, exposure before curves before colour; every module toggles | Ordered, toggleable adjustment stack replacing the flat slider list |
| **Krita** | Crop, transform and canvas ops are separate from paint ops; per-op reset | Split geometry (crop/rotate/flip) from tone (exposure/contrast/temp) into two panes |
| **OpenCut** | Trim handles on a filmstrip, snapping, keyboard nudge frame-by-frame | Filmstrip trim handles + `,` `.` frame nudge, snap to existing cue points |
| **pptWeb** | A deck is a document of slides with a shared master, not one slide | Multi-slide decks: master theme, per-slide layout picker, reorder, image placement |

### 3.6 Tutorial, extended

The coach model is right; it just needs more lessons and a way to see one again. Add lessons for:
the sidebar, projects, the script reader, joining a show, the presenter window, the mobile
transport. Add a "?" affordance on each pane that replays that pane's lesson without resetting all
of them.

### 3.7 Loose ends only the account owner can close

- Enable the **Google provider** in Supabase Auth, or the OAuth button stays broken.
- Add `electric13k.github.io`, `cueflow.pages.dev` and the Vercel domain to the Supabase
  **redirect allow-list**, or email links land on the wrong host.
- Turn on **leaked-password protection** in Supabase Auth.
- Diagnose **Netlify**, `netlify` CLI is not logged in here and the Netlify MCP will not connect,
  so its stale build cannot be investigated from this machine. Check the site's build log and
  whether auto-publish is off.

---

## 4. Mistakes

Honest list. These are mine.

**1. Rethemed the CSS and left the shader blue.**
The single biggest one. `Backdrop.tsx` paints an opaque cyan/violet field over the whole viewport
in dark mode. I rewrote every token in `styles.css`, fixed the waveform canvas and the slide canvas
for exactly this reason, *a canvas gets no CSS*, and then did not grep for the third canvas. I
reported the retheme as done on the evidence of `rgb(26,22,20)` on `body`, which was true and
irrelevant, because an opaque `-z-10` canvas sits on top of the body. The user was looking at a
blue site while I described a maroon one.

**2. Built the sidebar and mounted it on one route.**
`Shell` lives inside `pages/Workspace.tsx` and is used by `Workspace` alone. Studio, Projects,
Script, Settings and Account all still render bare `Page`. "I said sidebar u didnt make" is a fair
description of a sidebar you cannot reach from anywhere you actually work.

**3. Delete-then-insert on every save.**
Every change fired its own `persist()`, saves ran concurrently, each deleted a sequence's cues and
re-inserted them, and run A's insert collided with run B's delete →
`duplicate key value violates unique constraint "sequence_items_pkey"` on every single action. This
one is fixed (serialize + debounce + upsert + merge-dedupe, 19 tests) but it should never have
shipped: delete-then-insert is not a safe write pattern for anything with concurrent writers.

**4. Answered "revamp the look" with tokens instead of a look.**
Swapping hex values and a font stack is a palette change. The signature elements, the prompt-book
margin rule, the cue lamp, arrived late and thin, and the material (glass) was never
reconsidered at all until asked twice.

**5. Text where motion was asked for.**
Explanation pages were rewritten to be shorter, which was the letter of the ask. "More motion less
text" is a different instruction and only half of it was done.

**6. Treated the backlog as a checklist.**
Items got a shipped-shaped version each, an editor gained three sliders, a "tutorial" gained a
page, and the depth the word "trash" was pointing at was never addressed. Breadth was reported as
completion.

**7. Reported per-host deploy status without noticing all four hosts were not the point.**
Netlify being stale is real and worth saying. It is not worth saying *first*, above a site that is
the wrong colour.

---

## 5. Learnings

**A canvas gets no CSS.** Any `<canvas>`, 2D or WebGL, must read the palette out of the document
(`getComputedStyle(document.documentElement).getPropertyValue('--cue-audio')`) on every draw, and
re-draw on theme change. Three canvases in this app; each one needs it. When a theme changes,
`grep -r "canvas"` before claiming it is done.

**Verify the rendered thing, not the property you changed.** `body { background }` being correct
proves nothing if something opaque is painted over it. Screenshot the running page.

**Concurrent writers need a write pattern, not a retry.** Serialize per-resource, debounce the
trigger, upsert instead of delete-then-insert, and dedupe on merge. Any two of those alone still
leave a window.

**`requestAnimationFrame` does not fire in a background or non-compositing tab.** Anything that
must run when the tab is not being painted, measurement, queue draining, timers, uses
`setTimeout`. This cost a long false-negative debugging session on the coach.

**Two Realtime channels on the same topic in the same tab break delivery.** A debug probe
subscribing to the channel under test *was* the bug for a while. Do not instrument a channel by
joining it.

**GPL is a distribution question, and a web app distributes.** Shipping JS to a browser is
distribution. Behaviour, ordering and naming are free to copy; code is not. Credit by name.

**PostgREST exposes every function in `public` as an RPC endpoint.** Helper and trigger functions
need `revoke execute from anon, authenticated` or they are a public API.

**Auth answers must not vary by cause.** Wrong username and wrong password give one message; reset
always reports success. Otherwise the form is a user-enumeration oracle.

**Cloudflare Pages `--branch` silently decides Production vs Preview.** `--branch=master` here;
`main` deploys fine and changes nothing anyone can see. The edge also caches HTML, so a correct
deploy can look stale for a minute.

**HeroUI v3 compat layer is narrow.** `Input` takes only
`label/value/onValueChange/className/type/size/placeholder/autoComplete/autoFocus/onKeyDown`, no
`startContent`, no `onBlur`. Check `src/ui.tsx` before reaching for a v2 prop.

---

## 6. Next steps, phase by phase

Ordered by how much each one is currently hurting. Each phase ends with something visibly true.

### Phase 0, Kill the blue *(blocking everything else visual)*
- Rewrite `Backdrop.tsx`: palette read from the document, pushed as uniforms; maroon/olive house
  wash; motion slowed to near-still; grain.
- Re-check every remaining canvas: `WaveformEditor`, `SlideComposer`, `Filmstrip`, `Stage`,
  `lib/image.ts`.
- Remove `bg-gradient-to-br from-accent/15 to-secondary/10` from `ScreenCard`, `secondary` is
  still the old token.
- **Done when:** a screenshot of `/` in dark mode contains no pixel whose blue channel leads, and
  the theme toggle repaints the backdrop without a reload.

### Phase 1, The prism
- `.glass` rebuilt: base blur, spectral edge from offset conic gradients, pointer-tracked specular
  sweep behind a throttled custom property, `@supports` fallback, reduced-motion freeze.
- Apply deliberately: cards, modals, sidebar, the coach card. **Not** live deck rows.
- **Done when:** panels visibly bend what is behind them and the edge splits colour, at 60 fps on
  a mid phone.

### Phase 2, Shell everywhere
- `components/Shell.tsx` extracted from `Workspace`; wraps Workspace, Projects, Studio, Script,
  Settings, Account. Marketing routes keep `Page`.
- Active-route highlight; collapse state persisted.
- ~~`Nav.tsx` cut to seven items: logo, Home, Features, Workspace, theme toggle, Sign in, GitHub.~~
  **Superseded 2026-08-09 (see §3.3).** `Nav.tsx` carries logo, Home, Features, one working
  destination, the account control and GitHub. The working destination is Studio signed out and
  Workspace signed in, and inside the Shell it is dropped entirely. The theme toggle is gone (§14).
  Studio and Tutorial stay out of the bar as browsing destinations; the footer still links both.
- **Done when:** you can get from any working page to any project without the browser back button,
  and the top bar has nothing on it that the sidebar already does.

### Phase 3, Mobile and touch
- Long-press-to-lift drag with an explicit reorder toggle; `touch-action` audited everywhere.
- Two-handle region select on the waveform; 44 px handles on the crop box.
- Bottom-docked transport on small screens; next-cue is the biggest target.
- **Done when:** a full deck can be built and run at 375×812 without a mouse.

### Phase 4, Editors, properly
In order, because each is independently shippable:
1. Audio: undo/redo stack + live preview + gain envelope *(Audacity)*.
2. Image: ordered toggleable module stack, geometry split from tone *(darktable, Krita)*.
3. Video: filmstrip trim handles, frame nudge, snap to cue points *(OpenCut)*.
4. Slides: multi-slide deck with a master, layouts, image placement, reorder *(pptWeb)*.
- Credits page and README updated as each lands.
- **Done when:** each editor can do the thing its reference tool is known for, and none of its code
  is in this repo.

### Phase 5, Teaching
- Lessons for sidebar, projects, script reader, joining a show, presenter window, mobile transport.
- Per-pane "?" replays that pane's lesson only.
- Motion added to Features and Tutorial in place of remaining prose.
- **Done when:** a first-time user reaches a running deck without reading a paragraph.

### Phase 6, Owner-only loose ends
Cannot be done from this machine; listed so they are not lost:
- Enable Google provider in Supabase Auth.
- Add the three new hosts to the Supabase redirect allow-list.
- Enable leaked-password protection.
- Log into Netlify and read the build log.

---

## 7. Not doing, and why

- **YouTube / YouTube Music / Spotify / Apple Music import.** Licensed catalogues, and the
  protected ones need access-control circumvention. Substitutes shipped: Internet Archive,
  Wikimedia Commons, Openverse, paste-a-link, upload, Myinstants hand-off.
- **Bypassing the Myinstants bot check.** It is a bot check; the hand-off stays.
- **Copying any GPL source.** See §5. Behaviour and credit only.

---

# Part II, the shape of the app (2026-08-08)

Phases 0–5 above are landed. This part supersedes the navigation and page structure they assumed.
It is a specification, not a wish list: where it says *strictly*, the wording is the requirement.

## 8. Who sees what

- **Signed out:** Studio, Sequences and Library. Nothing else. No workspace, no projects, no shows.
- **Signed in:** the Workspace opens.

Sign-in is the gate for workspaces. It is not the gate for using the app.

**Terminology, fixed:** they are **sequences**. Never "running orders". Sweep the whole tree
strings, comments, docs, lesson copy.

## 9. Workspace (signed in)

- **Sidebar:** your projects.
- **Main screen:** recent sequences, **editor sessions**, library items, shows and scripts,
  **sorted by importance**, not by raw recency alone.

**Editor session = resumable per-item edit state.** Opening an item in an editor starts a session
that persists its in-progress state (crop box, trim in/out, adjustment-module stack, undo history)
to Supabase, so reopening lands exactly where you left off. New table, RLS-scoped to the owner,
listed on the Workspace and reopenable in one click.

## 10. The project screen

Click a project in the sidebar → **Library is the first screen**.

- Tabs are **Library | Sequences**. The old "Library / Editor / Sequences" triple is gone; the
  editor is reached by opening an item, not by a tab.
- **Above them sits the shows section.** Initially a single **button**. Create a show and it
  becomes a **grid** of created and recent shows for this project, and it stays a grid **forever**,
  until a new project is made, or every show is deleted.
- Beside it, a **script button** with the same behaviour, opening **to the side of shows**.
  Everything said about the shows button/grid applies to scripts.
- **Shows grid is larger than the scripts grid.** Hovering either one makes it larger still and
  brings it into focus.
- **Delete the current cards outright**, cueboard, script, personal library, show, setup guide,
  keybinds, sync, audience display. In their place: the shows grid and this project's recent shows.

### Selection changes the furniture

- Select an item in the library → a **toolbar appears above the library** and the **shows grid
  disappears**. Toolbar: **Edit · Add to sequence** (dropdown of this project's sequences) **·
  Download · Delete**.
- Deselect → the shows and scripts grids/buttons come back.

### Dragging, without opening anything

- Sequences → shows.
- Library items → sequences.
- Scripts → shows.

All three work directly on the grid; you never have to open "all shows in this project" first.

### Sequences

Selecting a sequence adds it to a show. Several sequences can be added to one show. A sequence can
also be run on its own, inside a show, or in a project outside any show, in presenter mode.

## 11. Show manager

Click a show in the grid → the **show manager**, in focus, covering the entire screen. Sequences,
library and script demote to grids around it; the show is the subject. This is where roles are
created, powers assigned, and the show edited.

**A show always starts in audience mode**, black, or white, when there is no background.

## 12. Search, sort, sync

- **Search exists in exactly four places:** library, sequences, shows, scripts. Plus **find in
  script**.
- **Sort-by and filters** alongside each search.
- **Auto sync**, always on.

## 13. The script reader

Currently weak. Reference: <https://cueflow.harda.dev/>, script paste, **Start**, speed, font
size, text colour, elapsed `00:00:00`. Take those and go further.

- **Auto-scroll.** It was designed out (`ScriptReader.tsx`, *"no timers, no playback"*); that was
  wrong for a teleprompter. Speed control, start/stop, elapsed timer.
- **Formatting must survive.** Root cause of it not appearing: `clean()` in `src/lib/script.ts`
  strips *every* attribute from *every* tag, so centring and indentation, which is what makes a
  script read as a script, are deleted along with the paper. Fix with a narrow property allowlist
  (`text-align`, `margin-left`, `text-indent`, `font-style`, `font-weight`) plus a mammoth
  `styleMap` for Word's paragraph styles. Allowlisting by property name still admits no `url()`,
  no `javascript:`, no expression, so the injection guarantee holds.
- **If formatting genuinely cannot be kept without it, keep the background.** Legibility of the
  script beats the aesthetic of losing the page.
- Find in script.

## 14. Look

- **Light beige glow / gradient background.**
- **Burgundy** and **olive green** (or a better green) for elements and text.
- **Dark mode stops being the global default.** The theme toggle comes out of the top bar and the
  app is beige everywhere by default.
- **Dark survives as a scoped working theme.** The dark tokens move from `<html>` onto a class
  scope that can be applied to any container, and the **Studio and the show manager carry a dark
  toggle** available to the **host and to every other role**. Someone operating from a dark venue
  gets a dark control screen without the marketing pages, the workspace or anyone else's device
  following them.
- **Per device, never broadcast.** One operator's choice of a dark control screen must not darken
  another member's. Persist it locally; keep it off the realtime channel.
- **Exception, non-negotiable:** audience and presenter output stay **black** regardless of any
  theme setting, and the toggle does not reach them. That is stage output, not a theme. A bright
  screen behind a performance is a bug, so it is structural rather than a token.

---

# Part III, the second pass (2026-08-09)

Part II shipped to four hosts. This is what came back on inspection. Where a line is a direct
quote it is treated as the requirement, not a paraphrase of one.

## 15. Broken, not merely thin

- **Creating a project fails.** The toast reads `new row violates row-level security policy for
  table "projects"`. The database is innocent: impersonating that exact user in a rolled back
  transaction, the exact insert is ALLOWED. The INSERT policy is
  `WITH CHECK (owner = (select auth.uid()))`, there are no triggers on `projects`, and
  `createProject` already sets `owner: user.id`. So the production request is not arriving as an
  authenticated user. Note `.env.local` carries a legacy JWT anon key while production ships the
  publishable key, which is exactly why localhost never reproduced it.
- **The dark toggle only darkens some things.** Components are using colour that does not come
  from a token, so the scoped class cannot reach them.
- **Mobile is wrong on both counts:** colours look faded and the screen is misaligned, cut or
  zoomed. Tablet is a stretched phone.
- **Manual scrolling does not re-arm the script.** Scrolling back to the start by hand, instead of
  pressing restart, leaves every cue still marked as fired, so the alerts never come back.
- **None of the editors work.** The GPL desktop tools were only ever behaviour references; the
  product needs real permissive libraries: wavesurfer.js for audio, Cropper.js for image geometry,
  pdf-lib beside pdfjs, and a lazy loaded ffmpeg.wasm for video.
- **Backend errors generally**, to be found from advisors and logs rather than guessed at.

## 16. Restricted where it should be direct

The sharpest note received: *"what is the purpose of the library appearing in the show panel if i
cant drag it into a sequence? the website feels restricted, more buttons less dragability."*

That is a design failure, not a missing feature. Wherever the obvious gesture is to drag a thing
onto another thing, it must work, starting with library items onto sequences inside the show panel.
`src/lib/dragList.ts` already handles long press to lift on touch, so it is reused rather than
duplicated. Every drag keeps a keyboard reachable alternative, because drag alone is not accessible.

## 17. Recents

No hierarchy today, and everything is dumped in. It gets categories, a date limit of the past
month only, and preview on hover for sequences, images, audio and decks. Tile sizes are literal:
a sequence tile is 2x the height of an audio tile, a deck tile is 2x the width and 2.5x the height.
Skeleton loading replaces spinners.

## 18. The show

A start button that opens the manager first rather than going live on the spot. The audience screen
both embedded in the manager and openable as its own window, that window carrying enough of its own
key handling that cues fire when it is the focused one, and exactly once when both are open. In the
manager: what is coming and when, what is next, the script, and a chat history, since device
messages exist today but are fire and forget.

## 19. Homepage, logo, alerts

The homepage is bland, under explained and ignores that people scan in an F pattern. It gets real
visuals from `public/shots`, headings that carry meaning when skimmed alone, and an explanation a
cold visitor understands in one screen. The logo becomes a C combined with theatre elements, with
every derived icon and the social card regenerated from it. Alert messages are too small and toasts
sit misaligned across the site.

## 20. Em dashes

Asked for twice, and still present. Purged from every file, and not to be reintroduced in code,
comments, UI copy, commit messages or documents.
