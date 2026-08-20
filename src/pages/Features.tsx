import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Cloud, Image, Keyboard, ListMusic, Monitor, Presentation, Radio, SlidersHorizontal, Users, Zap } from "lucide-react";
import Page from "../components/Page";
import { useReveal } from "../lib/motion";
import { Button } from "../ui";

const rise = (d = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" },
  transition: { duration: .55, delay: d, ease: [.16, 1, .3, 1] as const },
});

const mainFeatures = [
  {
    number: "01",
    icon: ListMusic,
    eyebrow: "Cue deck",
    title: "Run the show from one clear order.",
    body: "Build a sequence that keeps every sound, slide, and visual in the order the room will experience it. Arm the next cue, see what is standing by, and keep your place.",
    tags: ["Ordered sequences", "Drag to arrange", "Undo and redo"],
  },
  {
    number: "02",
    icon: Zap,
    eyebrow: "Live control",
    title: "Fire the right thing at the right moment.",
    body: "Use the transport bar, keyboard shortcuts, or a compact mobile control surface to move through the deck without juggling windows or hunting through folders.",
    tags: ["Fast playback", "Keyboard control", "Stage output"],
  },
  {
    number: "03",
    icon: Radio,
    eyebrow: "Rehearsal",
    title: "Make practice part of the show plan.",
    body: "Rehearse inside the same deck you will run. Add notes, mark cues as rehearsed, set cue timers, and review the run history when the room is ready.",
    tags: ["Cue timers", "Rehearsal notes", "Run history"],
  },
  {
    number: "04",
    icon: SlidersHorizontal,
    eyebrow: "Media workspace",
    title: "Prepare the material where you use it.",
    body: "Bring audio, images, video, and slides into one library, shape what needs shaping, then drop the finished material directly into the cue order.",
    tags: ["Audio and video", "Images and slides", "Library search"],
  },
  {
    number: "05",
    icon: Users,
    eyebrow: "Crew handoff",
    title: "Give the room one shared source of truth.",
    body: "Hand out a show key so the crew can join from their phones. Everyone sees the same cue plan while the operator keeps control of what goes live.",
    tags: ["Phone-ready", "Shared show access", "Operator-led"],
  },
  {
    number: "06",
    icon: Cloud,
    eyebrow: "Portable setup",
    title: "Keep the show ready wherever the work happens.",
    body: "Save reusable sequence templates, duplicate a working setup, and export or import a project backup when a production moves between devices.",
    tags: ["Templates", "Duplicate a setup", "Export and import"],
  },
];

const workflow = [
  { icon: Image, title: "Prepare", body: "Collect the media, make the cue order, and shape the material before anyone is waiting on the next call." },
  { icon: Presentation, title: "Rehearse", body: "Run the real sequence, use timers and notes, and mark the places that need another pass." },
  { icon: Monitor, title: "Operate", body: "Arm, fire, and hand off the show with one readable surface for the operator and the crew." },
];

export default function Features() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <Page>
      <div ref={root}>
        <motion.p {...rise()} className="font-mono text-[11px] uppercase tracking-[.36em] text-brass">Features</motion.p>
        <motion.h1 {...rise(.05)} className="mt-3 max-w-4xl text-5xl font-bold leading-[1.02] sm:text-6xl">
          The controls that keep a live show moving.
        </motion.h1>
        <motion.p {...rise(.1)} className="mt-5 max-w-2xl text-xl leading-snug text-muted sm:text-2xl">
          CueFlow gives the operator one readable place to prepare, rehearse, and run the room.
        </motion.p>

        <section className="mt-16 grid gap-5 md:grid-cols-2">
          {mainFeatures.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article key={feature.number} {...rise(index * .04)} data-reveal
                className="glass group relative overflow-hidden p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-8">
                <span className="pointer-events-none absolute -right-3 -top-8 font-display text-[8rem] font-bold leading-none text-accent/10">{feature.number}</span>
                <div className="relative">
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                      <Icon size={20} aria-hidden />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[.28em] text-brass">{feature.eyebrow}</span>
                  </div>
                  <h2 className="mt-7 max-w-md text-2xl font-bold leading-tight sm:text-3xl">{feature.title}</h2>
                  <p className="mt-3 max-w-xl leading-relaxed text-muted">{feature.body}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {feature.tags.map(tag => <span key={tag} className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[.15em] text-muted">{tag}</span>)}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </section>

        <section className="mt-20 border-y border-white/10 py-14 sm:py-16">
          <motion.div {...rise()}>
            <p className="font-mono text-[11px] uppercase tracking-[.36em] text-brass">The working loop</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">Less setup. More confidence when the room goes dark.</h2>
          </motion.div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {workflow.map((step, index) => {
              const Icon = step.icon;
              return (
                <motion.div key={step.title} {...rise(index * .08)} data-reveal className="margin-rule">
                  <Icon size={20} className="text-accent" aria-hidden />
                  <h3 className="mt-4 text-2xl font-bold">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{step.body}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        <motion.div {...rise()} className="glass mt-16 flex flex-wrap items-center justify-between gap-5 p-8 sm:p-10">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[.3em] text-brass">Ready when you are</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Build the cue order. Run the room.</h2>
          </div>
          <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-semibold">Open the Studio</Button>
        </motion.div>
      </div>
    </Page>
  );
}
