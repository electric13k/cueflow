import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Keyboard, ListMusic, Monitor, SlidersHorizontal, Upload, UserPlus } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";
import ScreenCard, { type Screen } from "../components/ScreenCard";
import { Button } from "../ui";

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

const screens: Screen[] = [
  {
    shot: "/shots/soundboard.png", title: "Soundboard",
    alt: "The CueFlow soundboard: a grid of sound cards above the transport bar",
    body: "Click a card and it plays. That's the whole interaction.",
    points: ["Scrub, speed and loop in the bar", "Multi-select with the checkmarks", "Nothing plays until you say so"],
  },
  {
    shot: "/shots/editor.png", title: "Waveform editor",
    alt: "The CueFlow waveform editor showing a rendered waveform and channel controls",
    body: "Drag across the waveform to pick a region, then reshape it.",
    points: ["Shift-drag to grab one channel", "Cut, copy, paste, merge, silence", "Saves a new sound — original untouched"],
  },
  {
    shot: "/shots/sequences.png", title: "Cue sequences",
    alt: "The CueFlow sequences tab showing a cue deck",
    body: "A deck of cues you step through like slides.",
    points: ["Arrow keys move one cue at a time", "Loop the deck, or start it blacked out", "Every key is rebindable"],
  },
  {
    shot: "/shots/phone.png", title: "On your phone", fit: "contain",
    alt: "CueFlow running on a phone",
    body: "The same board, sized for one thumb.",
    points: ["No install, no app store", "Sign in and it follows you", "Runs from the back of the room"],
  },
];

const steps = [
  {
    icon: Upload, title: "Get sounds in",
    body: "Hit Upload in the Library tab to add files from your computer. To pull one off the web, paste a direct link to the audio file in the import box — on Myinstants that means right-clicking the sound and copying the audio address, not the page URL. Imports keep their own name.",
  },
  {
    icon: SlidersHorizontal, title: "Shape a sound",
    body: "Pick a sound, open Editor, and drag across the waveform to select a region. Shift-drag to grab a single channel — each lane is labelled Left or Right. From there: cut, copy, paste, merge two sounds together, silence a stretch, mix to mono, or balance the channels. Undo is one click, and saving always writes a new sound rather than overwriting the original.",
  },
  {
    icon: ListMusic, title: "Build a cue deck",
    body: "In Sequences, make a sequence and add cues to it — like slides in a deck. Nothing ever autoplays: you step through cues with the arrow keys, one press per cue. Turn on Loop sequence to wrap back to the start.",
  },
  {
    icon: Monitor, title: "Run the show",
    body: "Audience display opens a pure-black window — drag it onto the projector or mirrored screen so the room sees nothing while you drive the board. You can start a sequence straight into audience mode from the Sequences tab.",
  },
  {
    icon: Keyboard, title: "Make the keys yours",
    body: "Open Keybinds to rebind everything: arrows step cues, and any key you like can nudge reverb, volume or speed live during playback.",
  },
  {
    icon: UserPlus, title: "Keep your work",
    body: "Your library lives in this browser. Sign in from the top bar and your sounds and sequences save to your account instead, so they follow you to any device.",
  },
];

export default function Tutorial() {
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <motion.p {...fade()} className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Tutorial</motion.p>
        <motion.h1 {...fade(.05)} className="mt-2 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">Running a show, start to finish.</motion.h1>
        <motion.p {...fade(.1)} className="mt-4 max-w-2xl text-lg text-muted">
          Six steps from an empty library to a cue deck you can drive with your arrow keys. The same guide opens on your first visit to the Studio — the Setup guide button brings it back any time.
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
            <p className="mt-2 text-muted">Open the Studio and add your first sound.</p>
          </div>
          <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
        </motion.div>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-muted sm:px-6 lg:px-8">
          <Link to="/" className="hover:text-foreground">← Back to home</Link>
          <Link to="/studio" className="font-semibold text-accent">Open Studio →</Link>
        </div>
      </footer>
    </div>
  );
}
