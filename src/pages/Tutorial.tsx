import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, RotateCcw } from "lucide-react";
import Page from "../components/Page";
import { useReveal } from "../lib/motion";
import ScreenCard, { type Screen } from "../components/ScreenCard";
import { Button } from "../ui";
import { forgetLessons } from "../lib/coach";
import { toast } from "../lib/toast";

/**
 * The long version used to live here: seven numbered paragraphs read before you had touched
 * anything. The Studio teaches itself now, one control at a time, as you open it -- so this page is
 * the shape of the thing and the keys, and nothing else.
 */
const rise = (d = 0) => ({
  initial: { opacity: 0, y: 20 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" }, transition: { duration: .55, delay: d, ease: [.16, 1, .3, 1] as const },
});

const screens: Screen[] = [
  {
    shot: `${import.meta.env.BASE_URL}shots/soundboard.png`, title: "Library",
    alt: "The CueFlow library: a grid of media cards above the transport bar",
    body: "Click a card and it fires. That is the whole interaction.",
    points: ["Sound, pictures, video and decks together", "Search your own or the open archives", "Nothing plays until you say so"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/editor.png`, title: "Editors",
    alt: "The CueFlow waveform editor showing a rendered waveform and channel controls",
    body: "Drag across the waveform to pick a region, then reshape it.",
    points: ["Shift-drag grabs one channel", "Cut, level, tone, mono to stereo", "Pictures and video get their own panel"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/sequences.png`, title: "The deck",
    alt: "The CueFlow sequences tab showing a cue deck",
    body: "A list you step through, one key at a time.",
    points: ["Sound and screens in one order", "Link a slide to the sound under it", "Arm it and the frame turns amber"],
  },
  {
    shot: `${import.meta.env.BASE_URL}shots/phone.png`, title: "On a phone", fit: "contain",
    alt: "CueFlow running on a phone",
    body: "The same board, sized for one thumb.",
    points: ["No install, no app store", "Runs from the back of the room"],
  },
];

/** The keys, which are the one thing worth memorising before you start. */
const keys = [
  { k: "→ ←", does: "Next cue, previous cue" },
  { k: "D A", does: "Next slide only, the sound underneath keeps running" },
  { k: "W S", does: "Zoom the stage" },
  { k: "Space", does: "Play or pause" },
];

export default function Tutorial() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <Page>
      <div ref={root}>
      <motion.p {...rise()} className="font-mono text-[11px] uppercase tracking-[.36em] text-brass">Tutorial</motion.p>
      <motion.h1 {...rise(.05)} className="mt-3 max-w-3xl text-5xl font-bold leading-[1.02] sm:text-6xl">
        Library, deck, <span className="italic text-accent">go.</span>
      </motion.h1>
      <motion.p {...rise(.1)} className="mt-5 max-w-xl text-lg text-muted">
        Put everything in the library. Drag it into the order you will call it. Arm it, and drive.
        The Studio explains each part as you open it, so there is nothing to memorise here except the keys.
      </motion.p>

      <section className="mt-14">
        <motion.h2 {...rise()} className="font-mono text-xs uppercase tracking-[.3em] text-muted">The four screens</motion.h2>
        <p className="mt-2 text-sm text-muted">Tap a card to turn it over.</p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {screens.map((s, i) => <ScreenCard key={s.title} {...s} delay={i * .05} />)}
        </div>
      </section>

      <section className="mt-16">
        <motion.h2 {...rise()} className="font-mono text-xs uppercase tracking-[.3em] text-muted">The keys</motion.h2>
        <ul className="mt-5 divide-y divide-white/10 border-y border-white/10">
          {keys.map(k => (
            <li key={k.k} data-reveal className="flex items-baseline gap-5 py-4">
              <kbd className="w-24 shrink-0 font-mono text-lg font-bold text-accent">{k.k}</kbd>
              <span className="text-muted">{k.does}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">All of them rebindable in <a className="text-accent underline-offset-4 hover:underline" href="/settings">Settings</a>.</p>
      </section>

      <motion.div {...rise()} className="glass mt-16 flex flex-wrap items-center justify-between gap-5 p-8">
        <div>
          <h2 className="text-3xl font-bold">Open it and add one sound.</h2>
          <p className="mt-2 text-muted">That is genuinely the first step.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="bordered" startContent={<RotateCcw size={16} />}
            onPress={() => { forgetLessons(); toast("Tips reset", "The Studio will explain each part again as you open it.", "success"); }}>
            Show the tips again
          </Button>
          <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-semibold">Open the Studio</Button>
        </div>
      </motion.div>
      </div>
    </Page>
  );
}
