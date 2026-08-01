# CueFlow

A React/Tailwind/WebGL stage-audio player with a non-destructive Web Audio editor, keyboard-driven manual sequences, audience-only presenter display, local persistence, and optional Supabase cloud storage.

## Run

`npm install && npm run dev`

The supplied MP3s are preloaded, and **Build Clue-less sequence** produces the 18 cues extracted from `Clue-Less Script.pdf`. Uploads work immediately in-browser; configure the two variables in `.env.example`, enable Anonymous Sign-Ins in Supabase Auth, and apply `supabase/migrations/0001_cueflow.sql` for private cloud Storage.

## Presenter mode

Open **audience display** in a separate window and move that window to the mirrored/projected screen. It is a pure-black window with no controls, cue text, or app chrome — the audience sees nothing while you drive cues from the primary display. The browser cannot pick the OS mirror target for you, so you position the window once.
