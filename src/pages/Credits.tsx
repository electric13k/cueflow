import { Heart } from "lucide-react";
import Page, { Section } from "../components/Page";

type Credit = { name: string; url: string; licence: string; what: string };

const TOOLS: Credit[] = [
  {
    name: "Audacity", url: "https://www.audacityteam.org/", licence: "GPL-2.0-or-later",
    what: "The sound editor's shape: a waveform you scrub and select, a time ruler above it, destructive edits applied to a selection, and a three-band tone stack. Fade, normalise, amplify, reverse and trim behave the way Audacity taught a generation they should.",
  },
  {
    name: "Audiomass", url: "https://audiomass.co/", licence: "MIT",
    what: "Proof that a real waveform editor belongs in a browser tab, and the model for how zoom, selection and playhead should feel with no install.",
  },
  {
    name: "darktable", url: "https://www.darktable.org/", licence: "GPL-3.0-or-later",
    what: "The order of the picture controls. Exposure, then contrast, then colour, then the local effects — adjust in that order and each control still reads true after the one before it.",
  },
  {
    name: "Krita", url: "https://krita.org/en/", licence: "GPL-3.0-or-later",
    what: "Crop behaviour: ratio presets constrain the drag rather than squashing the result, with a rule-of-thirds guide on by default.",
  },
  {
    name: "OpenCut", url: "https://opencut.app/", licence: "MIT",
    what: "The trim strip. You cut video by looking at thumbnails and dragging handles, not by typing seconds into a box.",
  },
  {
    name: "pptWeb", url: "https://github.com/theBigGavin/pptWeb", licence: "MIT",
    what: "The slide composer's default layout — title, accent rule, bulleted lines — and the idea that a deck tool should offer a good layout instead of an empty canvas.",
  },
];

const SOURCES: Credit[] = [
  { name: "Internet Archive", url: "https://archive.org/", licence: "Varies per item", what: "Public-domain and Creative Commons recordings, searchable in the importer." },
  { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/", licence: "Varies per item", what: "Freely licensed sound, stills and footage." },
  { name: "Openverse", url: "https://openverse.org/", licence: "Varies per item", what: "One open index over Jamendo, Freesound, Flickr and others. Each result shows its licence." },
  { name: "Myinstants", url: "https://www.myinstants.com/", licence: "Third-party terms", what: "Opened in its own tab so you can grab a sound under its own terms and bring the file back." },
];

function Row({ c }: { c: Credit }) {
  return (
    <li className="border-t border-border py-4 first:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <a href={c.url} target="_blank" rel="noreferrer noopener" className="font-bold text-accent underline-offset-4 hover:underline">{c.name}</a>
        <span className="rounded-full bg-surface/70 px-2 py-0.5 text-[11px] font-semibold text-muted">{c.licence}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{c.what}</p>
    </li>
  );
}

export default function Credits() {
  return (
    <Page width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Thanks</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Standing on open shoulders</h1>
      <p className="mt-2 text-sm text-muted">
        CueFloww's editors were built by studying tools that got these problems right first.
      </p>

      <div className="glass mt-10 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><Heart size={20} className="text-accent" />Behaviour, not code</h2>

        <Section title="What was borrowed">
          <p>
            Every project below is open source, and several are licensed under the GPL. The GPL asks that
            anything built from its code carry the same licence — and a web app hands its own source to
            every visitor's browser, which counts as distributing it.
          </p>
          <p>
            So <b>none of their code is in CueFloww</b>. What was taken is the part that is free to take
            anyway: the behaviour. Which control comes first, what a crop handle should do, what a trim
            strip should look like. That is the hard-won part, and it is theirs. Go and use the real tools —
            each does far more than a cue player needs to.
          </p>
        </Section>

        <ul className="mt-6">{TOOLS.map(c => <Row key={c.name} c={c} />)}</ul>
      </div>

      <div className="glass mt-6 p-6 sm:p-8">
        <h2 className="text-2xl font-black tracking-tight">Where the media comes from</h2>
        <p className="mt-2 text-sm text-muted">
          Licences vary per item and several require attribution. Checking what you are about to perform in
          public is on you.
        </p>
        <ul className="mt-6">{SOURCES.map(c => <Row key={c.name} c={c} />)}</ul>
      </div>

      <div className="glass mt-6 p-6 sm:p-8">
        <h2 className="text-2xl font-black tracking-tight">Built with</h2>
        <p className="mt-2 text-sm text-muted">
          React, Vite, Tailwind CSS, HeroUI, react-aria-components, Lucide icons, Supabase, and the Web
          Audio API — which does all the sound work here, in your browser, with nothing uploaded to process it.
        </p>
      </div>
    </Page>
  );
}
