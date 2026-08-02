import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardBody } from "../ui";
import { motion } from "framer-motion";
import { ArrowRight, Check, Cloud, Download, Keyboard, ListMusic, Monitor, Music, SlidersHorizontal, Sparkles, Zap } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";

const features = [
  { icon: Cloud, title: "Cloud sound library", body: "Upload your own audio or import from Myinstants. Files persist in cloud storage, saved to your account." },
  { icon: SlidersHorizontal, title: "Waveform editor", body: "Clip a region, mix to mono, balance left/right channels, plus speed, reverb, fades, distortion and reverse." },
  { icon: ListMusic, title: "Manual cue sequences", body: "Build slideshow-style decks that never autoplay. Loop them, or launch straight into audience mode." },
  { icon: Keyboard, title: "Configurable keybinds", body: "Drive a show like a presenter: arrow keys step through cues, custom keys nudge reverb, volume and speed." },
  { icon: Monitor, title: "Blackout presenter mode", body: "A pure-black audience window for the mirrored screen — the room sees nothing while you run the board." },
  { icon: Zap, title: "Live effects in playback", body: "Tune reverb, speed, volume and fades on the fly, not just in the editor." },
];

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

type Screen = { shot: string; alt: string; title: string; body: string; points: string[]; fit?: "cover" | "contain" };
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

/** Flip card: the screenshot on the front, what it does on the back. */
function ScreenCard({ shot, alt, title, body, points, fit = "cover", delay }: Screen & { delay: number }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div {...fade(delay)} style={{ perspective: "1400px" }}>
      <button
        onClick={() => setFlipped(f => !f)}
        aria-label={`${title} — flip for details`}
        aria-pressed={flipped}
        className="group relative block h-[24rem] w-full text-left [transform-style:preserve-3d] transition-transform duration-500 ease-out"
        style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "none" }}
      >
        <span className="glass glass-hover absolute inset-0 flex flex-col overflow-hidden p-2 [backface-visibility:hidden]" style={{ backfaceVisibility: "hidden" }}>
          <img src={shot} alt={alt} loading="lazy" className={`min-h-0 flex-1 rounded-2xl bg-black/30 object-top ${fit === "contain" ? "object-contain" : "object-cover"}`} />
          <span className="flex items-center justify-between px-2 py-2 text-sm font-bold">
            {title}
            <span className="text-xs font-medium text-muted">Flip →</span>
          </span>
        </span>
        <span
          className="glass absolute inset-0 flex flex-col justify-center gap-3 border-accent/25 bg-gradient-to-br from-accent/15 to-secondary/10 p-6 [backface-visibility:hidden]"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <h3 className="text-xl font-black tracking-tight">{title}</h3>
          <p className="text-sm text-muted">{body}</p>
          <ul className="mt-1 space-y-2">
            {points.map(p => (
              <li key={p} className="flex gap-2 text-sm">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <span className="mt-2 text-xs text-muted">← Flip back</span>
        </span>
      </button>
    </motion.div>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <section className="grid place-items-center py-20 text-center sm:py-28">
          <motion.div initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .5 }} className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[.28em] text-accent">
            <Sparkles size={13} /> Live audio cue system
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .05 }} className="mt-6 max-w-4xl text-5xl font-black leading-[1.03] tracking-tight sm:text-7xl">
            Run your sound like a <span className="bg-gradient-to-r from-accent to-secondary bg-clip-text text-transparent">slideshow</span>.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }} className="mt-6 max-w-2xl text-lg text-muted">
            CueFlow is a browser soundboard for theatre, presentations and streams: a waveform editor, arrow-key cue sequences, and a blackout presenter display — no downloads, no autoplay surprises.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .19 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
            <Button as="a" href="#features" size="lg" variant="bordered">See features</Button>
          </motion.div>
        </section>

        <section id="features" className="scroll-mt-20 py-10">
          <motion.h2 {...fade()} className="text-center text-3xl font-black tracking-tight sm:text-4xl">Everything a cue board needs</motion.h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div key={f.title} {...fade(i * .05)}>
                <Card className="glass glass-hover h-full bg-transparent"><CardBody className="gap-3 p-6">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/15 text-accent"><f.icon size={22} /></div>
                  <h3 className="text-lg font-bold">{f.title}</h3>
                  <p className="text-sm text-muted">{f.body}</p>
                </CardBody></Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="screens" className="scroll-mt-20 py-10">
          <motion.h2 {...fade()} className="text-center text-3xl font-black tracking-tight sm:text-4xl">A look at the board</motion.h2>
          <p className="mt-3 text-center text-sm text-muted">Tap a card to flip it over.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {screens.map((s, i) => <ScreenCard key={s.title} {...s} delay={i * .05} />)}
          </div>
        </section>

        <section className="py-16">
          <motion.div {...fade()}>
            <Card className="glass overflow-hidden border-accent/20 bg-gradient-to-br from-accent/15 to-secondary/10">
              <CardBody className="grid items-center gap-6 p-8 sm:grid-cols-[1fr_auto] sm:p-12">
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Ready to build your first show?</h2>
                  <p className="mt-3 max-w-xl text-muted">Upload a few sounds, drop them into a sequence, and drive it with your arrow keys. Sign in and it all saves to your account.</p>
                </div>
                <Button href="/studio" color="primary" size="lg" endContent={<Music size={18} />} className="font-bold shadow-lg shadow-accent/30">Launch Studio</Button>
              </CardBody>
            </Card>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-muted sm:px-6 lg:px-8">
          <span className="flex items-center gap-2"><Download size={14} /> CueFlow — React · HeroUI · Supabase · WebGL</span>
          <span className="flex items-center gap-4">
            <Link to="/legal#terms" className="hover:text-foreground">Terms</Link>
            <Link to="/legal#privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/studio" className="font-semibold text-accent">Open Studio →</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
