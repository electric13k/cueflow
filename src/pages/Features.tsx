import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { AudioWaveform, BookOpen, Cloud, Command, FolderTree, Keyboard, KeyRound, Link2, ListMusic, Monitor, Radio, SlidersHorizontal, Users, Zap } from "lucide-react";
import Page from "../components/Page";
import ClosingCta from "../components/ClosingCta";
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

/**
 * The rest of what is in the app.
 *
 * This section used to be a "Prepare / Rehearse / Operate" trio that restated cards 01, 03 and 02
 * in different words -- the page said the same three things twice and never mentioned the script
 * reader, the editors, per-job permissions or the audience window at all.
 */
const alsoIncluded = [
  { icon: FolderTree, title: "Projects and collaborators", body: "Keep separate productions apart, and invite people into one by name. Their library, sequences and shows come with it." },
  { icon: BookOpen, title: "Script reader with pre-alerts", body: "Scroll the script beside the deck. Name the words that matter and it warns you before they arrive, at whatever distance you set." },
  { icon: AudioWaveform, title: "Audio and image editors", body: "Trim, fade, normalise, reverse, split channels or downmix to mono, and crop a still, without leaving for another app." },
  { icon: Link2, title: "Linked cues", body: "Pair a slide with the sound that belongs under it. Calling either one sends both, and the deck keeps its place on the cue you called." },
  { icon: Monitor, title: "Audience window", body: "A second window with nothing on it but the show: no chrome, no toasts, no cursor. Put it on the projector and forget it." },
  { icon: KeyRound, title: "Permissions per job", body: "A key is a job. Followspot gets the cue list; the deputy gets everything but the stage. Six switches, and the host decides." },
  { icon: Command, title: "Command palette", body: "One shortcut to every action in the Studio, so a control you use twice a year is still one search away." },
  { icon: Cloud, title: "Cloud sync and backups", body: "Signed in, the library and sequences follow you between devices. Signed out, everything still works and stays on the device." },
];

export default function Features() {
  const root = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLElement>(null);
  const { scrollYProgress: workflowProgress } = useScroll({ target: workflowRef, offset: ["start 82%", "end 30%"] });
  const workflowRail = useTransform(workflowProgress, [0, 1], [0, 1]);
  const prefersReducedMotion = useReducedMotion();
  useReveal(root);
  return (
    <Page>
      <div ref={root} className="relative">
        <div aria-hidden className="feature-ambient pointer-events-none absolute inset-x-0 top-24 -z-10 overflow-hidden" data-ribbon-hitbox>
          <motion.span className="feature-orbit feature-orbit--brass" animate={prefersReducedMotion ? undefined : { rotate: 360, y: [0, -16, 0] }} transition={{ rotate: { duration: 28, repeat: Infinity, ease: "linear" }, y: { duration: 9, repeat: Infinity, ease: "easeInOut" } }} />
          <motion.span className="feature-orbit feature-orbit--curtain" animate={prefersReducedMotion ? undefined : { rotate: -360, y: [0, 12, 0] }} transition={{ rotate: { duration: 34, repeat: Infinity, ease: "linear" }, y: { duration: 11, repeat: Infinity, ease: "easeInOut" } }} />
        </div>
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
                className="glass feature-card group relative overflow-hidden p-6 sm:p-8">
                <span className="pointer-events-none absolute -right-3 -top-8 font-display text-[8rem] font-bold leading-none text-accent/10">{feature.number}</span>
                <div className="relative">
                  <div className="flex items-center justify-between gap-4">
                    <span className="feature-icon flex h-11 w-11 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
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

        <section ref={workflowRef} className="relative mt-20 border-y border-white/10 py-14 sm:py-16">
          <motion.div aria-hidden className="workflow-rail" style={{ scaleX: workflowRail }} />
          <motion.div {...rise()}>
            <p className="font-mono text-[11px] uppercase tracking-[.36em] text-brass">Also in the box</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">The parts that only matter once you are running it.</h2>
          </motion.div>
          <div className="workflow-grid relative mt-10 grid gap-8 md:grid-cols-3">
            {alsoIncluded.map((item, index) => {
              const Icon = item.icon;
              return (
                <motion.div key={item.title} {...rise(index * .05)} data-reveal className="margin-rule">
                  <Icon size={20} className="text-accent" aria-hidden />
                  <h3 className="mt-4 text-xl font-bold">{item.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted">{item.body}</p>
                </motion.div>
              );
            })}
          </div>
        </section>

        <ClosingCta eyebrow="Ready when you are" title="Build the cue order. Run the room." />
      </div>
    </Page>
  );
}
