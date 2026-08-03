import { motion } from "framer-motion";
import { ArrowRight, Keyboard, ListMusic, Monitor, Presentation, SlidersHorizontal, Upload, UserPlus } from "lucide-react";
import Page from "../components/Page";
import ScreenCard, { type Screen } from "../components/ScreenCard";
import { Button } from "../ui";

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

const screens: Screen[] = [
  {
    shot: `${import.meta.env.BASE_URL}shots/soundboard.png`, title: "Library",
    alt: "The CueFloww library: a grid of media cards above the transport bar",
    body: "Click a card and it fires. That's the whole interaction.",
    points: ["Sound, images, video and decks together", "Search your library or the free archives", "Multi-select with the checkmarks", "Nothing plays until you say so"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/editor.png`, title: "Editors",
    alt: "The CueFloww waveform editor showing a rendered waveform and channel controls",
    body: "Drag across the waveform to pick a region, then reshape it. Images and video get their own panel.",
    points: ["Shift-drag to grab one channel", "Cut, copy, paste, merge, silence", "Framing, colour and captions for slides", "Trim video without re-encoding"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/sequences.png`, title: "Cue sequences",
    alt: "The CueFloww sequences tab showing a cue deck",
    body: "A deck of cues you step through like slides.",
    points: ["Mix sound, slides and video in one deck", "Arrow keys move one cue at a time", "A and D move slides only", "Every key is rebindable"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/phone.png`, title: "On your phone", fit: "contain",
    alt: "CueFloww running on a phone",
    body: "The same board, sized for one thumb.",
    points: ["No install, no app store", "Sign in and it follows you", "Runs from the back of the room"],
  },
];

const steps = [
  {
    icon: Upload, title: "Get media in",
    body: "Hit Upload in the Library tab to add audio, images or video from your computer; names are cleaned up automatically, so airhorn-2_final.mp3 lands as “Airhorn 2 Final”. The search bar has a source picker: filter your own library, search the Internet Archive or Wikimedia Commons for freely licensed recordings, hand off to Myinstants, or paste a direct link. Every card also has a download button.",
  },
  {
    icon: Presentation, title: "Add slides",
    body: "New slide makes a blank 16:9 card you can put a title on, and that caption stays editable afterwards. Exported slide images drop straight in (PowerPoint: File, Export, PNG; Google Slides: File, Download, PNG). To keep a live deck instead, paste its Google Slides or PowerPoint Online link and CueFloww embeds it.",
  },
  {
    icon: SlidersHorizontal, title: "Shape it",
    body: "Pick a sound and open Editor to drag across the waveform: cut, copy, paste, merge, silence, mix to mono, balance the channels, then play the edit, the selection or the original before saving. Pick an image or video instead and the same tab becomes a media panel: transition, framing, zoom, rotation, mirroring, brightness, contrast, saturation, blur, caption, and for video the trim, speed, mute and loop. None of it touches the original file.",
  },
  {
    icon: ListMusic, title: "Build a cue deck",
    body: "In Sequences, make a sequence and add cues to it. Sound and visuals live in the same deck, so audio 1, slide 1, audio 2, slide 2 is one list you drag into order. Each visual cue picks its own transition. Nothing ever autoplays: you step through cues yourself.",
  },
  {
    icon: Monitor, title: "Run the show",
    body: "Audience display opens a presenter window, drag it onto the projector or mirrored screen. It stays black while the cue is sound alone, and shows the slide or video the moment a visual cue fires, with the transition you chose. Arm a sequence straight into audience mode from the Sequences tab; arming loads the deck without firing anything, so cue 1 waits for your first arrow press.",
  },
  {
    icon: Keyboard, title: "Drive it from the keyboard",
    body: "Arrow keys step every cue, one press per cue. A and D step the visual cues only, so the deck moves without cutting the sound underneath, and W and S zoom the stage. Keys work from whichever window has focus, including the presenter one. Open Keybinds to rebind any of it, or to put reverb, volume and speed on keys of your own.",
  },
  {
    icon: UserPlus, title: "Keep your work",
    body: "Your library lives in this browser. Sign in from the top bar and your media and sequences save to your account instead, so they follow you to any device.",
  },
];

export default function Tutorial() {
  return (
    <Page>
      <motion.p {...fade()} className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Tutorial</motion.p>
      <motion.h1 {...fade(.05)} className="mt-2 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">Running a show, start to finish.</motion.h1>
      <motion.p {...fade(.1)} className="mt-4 max-w-2xl text-lg text-muted">
        Seven steps from an empty library to a deck of sound and slides you can drive with your arrow keys. The same guide opens on your first visit to the Studio, the Setup guide button brings it back any time.
      </motion.p>

      <section className="py-12">
        <h2 className="text-2xl font-black tracking-tight">The four screens</h2>
        <p className="mt-2 text-sm text-muted">Tap a card to flip it over.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {screens.map((s, i) => <ScreenCard key={s.title} {...s} delay={i * .05} />)}
        </div>
      </section>

      <section className="py-4">
        <h2 className="text-2xl font-black tracking-tight">Step by step</h2>
        <ol className="mt-8 space-y-4">
          {steps.map((s, i) => (
            <motion.li key={s.title} {...fade(i * .04)} className="glass flex gap-4 p-6">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent"><s.icon size={22} /></div>
              <div>
                <h3 className="text-lg font-bold"><span className="text-accent">{i + 1}.</span> {s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </section>

      <motion.div {...fade()} className="glass mt-8 flex flex-wrap items-center justify-between gap-4 border-accent/20 bg-gradient-to-br from-accent/15 to-secondary/10 p-8">
        <div>
          <h2 className="text-2xl font-black tracking-tight">That's the whole tool.</h2>
          <p className="mt-2 text-muted">Open the Studio and add your first cue.</p>
        </div>
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
      </motion.div>
    </Page>
  );
}
