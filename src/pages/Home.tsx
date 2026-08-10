import { useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Radio } from "lucide-react";
import LogoMark from "../components/LogoMark";
import Page from "../components/Page";
import { useSignedIn } from "../components/RequireAuth";
import { useReveal, usePinScrub } from "../lib/motion";
import { Button } from "../ui";

/**
 * The homepage explains the product to somebody who has never run a show, and it is laid out for the
 * way that person reads: the widest line at the top, a shorter one under it, then everything
 * anchored to the left edge so a skim down that edge alone still says what this is. Every visual is
 * a real screen out of `public/shots`, because a drawing of a product is not evidence of one.
 */
const rise = (d = 0) => ({
  initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" }, transition: { duration: .6, delay: d, ease: [.16, 1, .3, 1] as const },
});

const shot = (name: string) => `${import.meta.env.BASE_URL}shots/${name}.png`;

/**
 * The explanation, in the order a stranger needs it: what the thing is, why it beats what they do
 * now, what they will be looking at while it runs, and who else is holding a screen. Each heading is
 * a whole claim on its own, so skimming the left edge is enough.
 */
const beats = [
  {
    n: "1",
    head: "A cue is one thing the room gets",
    line: "One sound, one slide, one video, with the number you will call it by written beside it. Sound counts 1, 2, 3. Screens count a, b, c.",
    points: ["Everything the show needs sits in one library", "Drag it into the order you will call it", "Nothing plays until you call it"],
    src: shot("sequences"),
    alt: "The CueFlow deck: a numbered list of cues, sound and screens in one order",
  },
  {
    n: "2",
    head: "One list replaces four windows",
    line: "A media player, a slide deck, a video window and a folder is four places to look and four ways to be a beat late. The deck is one place, and the key is already under your finger.",
    points: ["Arrow keys step the deck", "A and D step the slide without touching the sound", "Rebind any of it in Settings"],
    src: shot("soundboard"),
    alt: "The CueFlow library: a grid of media cards above the transport bar",
  },
  {
    n: "3",
    head: "The desk tells you what is out and what is next",
    line: "On now, standing by, and how much sound has to finish before the next cue can land. That is the whole readout, and it is the same on every device in the room.",
    points: ["The audience screen sits on the desk, black until you send something", "Send it to its own window for the projector", "The clock keeps running when the tab is behind another"],
    src: shot("editor"),
    alt: "The CueFlow editor showing a rendered waveform and its controls",
  },
  {
    n: "4",
    head: "The crew join on their phones",
    line: "Hand out a key and everyone holding a phone gets the same board, silently. No install, no app store, nothing to hand back at the end.",
    points: ["Works from the back of the room", "Messages between devices, never a sound"],
    src: shot("phone"),
    alt: "CueFlow running on a phone",
  },
];

export default function Home() {
  const signedIn = useSignedIn();
  // Triggers are made top to bottom in page order: the explanation rows, then the held line under them.
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  usePinScrub(root);
  return (
    <Page>
      <div ref={root}>
        {/* The top bar of the F. Longest line first, a shorter one under it, both hard left. */}
        <section className="py-12 sm:py-16">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8 }}
            className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[.42em] text-brass">
            <LogoMark size={26} /> The prompt corner, in a browser
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .08, ease: [.16, 1, .3, 1] }}
            className="mt-5 max-w-4xl text-5xl font-bold leading-[.98] sm:text-7xl">
            Run the whole show off one key.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .2 }}
            className="mt-5 max-w-2xl text-2xl font-semibold leading-snug text-accent sm:text-3xl">
            Every sound and slide in one numbered list.
          </motion.p>
          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .28 }}
            className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
            That list is a cue board. You build it once, you stand by, and one press sends the next thing out.
            The room hears it when you call it, never a second sooner.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .36 }}
            className="mt-9 flex flex-wrap items-center gap-3">
            {/* This one opens the show manager. It does not go live: that is a second, deliberate
                press inside the manager, so a button can be pressed to look at something. */}
            <Button href="/studio?show=new" color="primary" size="lg" startContent={<Radio size={18} />} className="font-semibold">
              Start a show
            </Button>
            <Button href="/studio" size="lg" variant="bordered" endContent={<ArrowRight size={18} />}>Open the Studio</Button>
            {signedIn && <Button href="/show" size="lg" variant="light">Join one</Button>}
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .7, delay: .44 }}
            className="mt-3 text-sm text-muted">
            Start a show opens the manager. Nothing reaches the room until you press Go live in it.
          </motion.p>

          {/* The first real evidence, at the top where the eye is still wide. */}
          <motion.figure initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .5, ease: [.16, 1, .3, 1] }}
            className="glass mt-12 overflow-hidden p-2">
            <img src={shot("sequences")} width={1600} height={900} loading="eager"
              alt="The CueFlow deck with a sequence armed: numbered cues, the armed one framed in amber"
              className="w-full rounded-2xl bg-black/30 object-cover object-top" />
            <figcaption className="px-3 py-3 text-sm text-muted">
              The deck, armed. The amber frame is the cue standing by; the arrow key fires it.
            </figcaption>
          </motion.figure>
        </section>

        {/* The stem of the F: heading, then a short line, all of it starting at the same left edge. */}
        <section className="border-t border-white/10">
          {beats.map(b => (
            <div key={b.n} data-reveal
              className="grid items-start gap-8 border-b border-white/10 py-14 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
              <div className="margin-rule">
                <span className="cue-mark text-brass">{b.n}</span>
                <h2 className="text-3xl font-bold leading-tight sm:text-4xl">{b.head}</h2>
                <p className="mt-3 text-muted">{b.line}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {b.points.map(p => (
                    <li key={p} className="flex gap-2.5">
                      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span className="text-muted">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <figure className="glass overflow-hidden p-2">
                <img src={b.src} alt={b.alt} loading="lazy" width={1600} height={900}
                  className="w-full rounded-2xl bg-black/30 object-cover object-top" />
              </figure>
            </div>
          ))}
        </section>

        {/* Held for half a screen, the way a house lights fade is held. Nothing moves but opacity. */}
        <section data-pin className="py-20">
          <blockquote data-pin-inner className="max-w-3xl">
            <p className="text-3xl font-bold italic leading-snug sm:text-5xl">
              A desk decides what goes out and when.
              <span className="text-accent"> You should decide the when.</span>
            </p>
          </blockquote>
        </section>

        <section className="pb-24">
          <motion.div {...rise()} className="glass flex flex-wrap items-center justify-between gap-6 px-8 py-12">
            <div>
              <h2 className="text-4xl font-bold sm:text-5xl">Curtain up.</h2>
              <p className="mt-3 max-w-md text-muted">Free, in the browser, nothing to install. Add one sound and the rest follows.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button href="/studio?show=new" color="primary" size="lg" startContent={<Radio size={18} />} className="font-semibold">Start a show</Button>
              <Button href="/tutorial" size="lg" variant="bordered" endContent={<ArrowRight size={18} />}>See how it works</Button>
            </div>
          </motion.div>
        </section>
      </div>
    </Page>
  );
}
