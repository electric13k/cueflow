import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Cloud, Film, Image, Keyboard, ListMusic, Monitor, Presentation, Radio, Search, SlidersHorizontal, Zap } from "lucide-react";
import Page from "../components/Page";
import { useReveal } from "../lib/motion";
import { Button } from "../ui";

/**
 * A feature list is a list, so it reads like one: a name and the shortest true sentence. The old
 * page spent forty words on each entry explaining things nobody had asked about yet.
 */
const rise = (d = 0) => ({
  initial: { opacity: 0, y: 20 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" }, transition: { duration: .55, delay: d, ease: [.16, 1, .3, 1] as const },
});

const groups = [
  {
    title: "Get it in",
    items: [
      { icon: Cloud, title: "Upload anything", body: "Audio, images, video. Names tidy themselves." },
      { icon: Search, title: "Search the open archives", body: "Internet Archive, Wikimedia Commons, Openverse." },
      { icon: Presentation, title: "Slides", body: "Type one, drop one in, or embed a live deck." },
    ],
  },
  {
    title: "Shape it",
    items: [
      { icon: SlidersHorizontal, title: "Sound", body: "Cut, level, tone, mono to stereo. Hear it before you save." },
      { icon: Image, title: "Pictures", body: "Crop, grade, warm or cool it. Nothing leaves the browser." },
      { icon: Film, title: "Video", body: "Trim to the seconds you need. No re-encode." },
    ],
  },
  {
    title: "Call it",
    items: [
      { icon: ListMusic, title: "One deck", body: "Sound counts 1, 2, 3. Screens count a, b, c." },
      { icon: Monitor, title: "Presenter window", body: "Black until a visual cue fires." },
      { icon: Keyboard, title: "Your keys", body: "Arrows step cues, A and D step slides. All rebindable." },
      { icon: Zap, title: "Live", body: "Reverb, speed and level move while it plays." },
      { icon: Radio, title: "The whole room", body: "Hand out a key; the crew join on their phones. Silent." },
    ],
  },
];

export default function Features() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <Page>
      <div ref={root}>
      <motion.p {...rise()} className="font-mono text-[11px] uppercase tracking-[.36em] text-brass">Features</motion.p>
      <motion.h1 {...rise(.05)} className="mt-3 max-w-3xl text-5xl font-bold leading-[1.02] sm:text-6xl">
        Everything a show needs. <span className="italic text-accent">Nothing it doesn't.</span>
      </motion.h1>

      {groups.map(g => (
        <section key={g.title} className="mt-16">
          <motion.h2 {...rise()} className="font-mono text-xs uppercase tracking-[.3em] text-muted">{g.title}</motion.h2>
          <ul className="mt-5 divide-y divide-white/10 border-y border-white/10">
            {g.items.map(f => (
              <li key={f.title} data-reveal
                className="flex items-baseline gap-4 py-4 transition hover:text-foreground motion-safe:hover:translate-x-1.5">
                <f.icon size={18} className="shrink-0 translate-y-0.5 text-accent" aria-hidden />
                <h3 className="w-48 shrink-0 text-lg font-bold">{f.title}</h3>
                <p className="text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <motion.div {...rise()} className="glass mt-16 flex flex-wrap items-center justify-between gap-5 p-8">
        <h2 className="text-3xl font-bold">Build a deck in five minutes.</h2>
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-semibold">Open the Studio</Button>
      </motion.div>
      </div>
    </Page>
  );
}
