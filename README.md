# CueFlow

A React / Tailwind / HeroUI / WebGL stage-audio cue player: cloud sound library, a non-destructive Web Audio editor (speed, volume, gain, reverb, fade, distortion, reverse), keyboard-driven manual sequences, live playback effects, and a blackout audience display for presenter mode.

## Run

```
npm install && npm run dev
```

Copy `.env.example` to `.env` and set the two Supabase variables for cloud storage. Uploads (local files or a Myinstants URL) are saved to the public Supabase `audio` bucket; sound and sequence metadata persist in the browser. Without Supabase vars the app still runs — uploads live in-browser only.

## Presenter mode

Click **Audience display** to open a pure-black window with no controls or chrome, then drag it onto the mirrored/projected screen — the audience sees nothing while you drive cues from the primary display. Sequences never autoplay: advance with the ← → arrow keys or click a cue. The browser can't pick the OS mirror target for you, so position the window once.
