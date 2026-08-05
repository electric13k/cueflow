import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Page from "../components/Page";
import { Button } from "../ui";

/**
 * The homepage is a playbill, not a manual. It says what this is and what it feels like to run one;
 * the tutorial is where you learn to work it.
 */

/** The cue light in the prompt corner: red is standby, green is go. It is the whole language. */
function CueLight() {
  const still = useReducedMotion();
  const lamp = (on: boolean, colour: string, delay: number) => ({
    animate: still ? { opacity: on ? 1 : .18 } : { opacity: on ? [.18, 1, 1, .18] : [1, .18, .18, 1] },
    transition: still ? {} : { duration: 6, times: [0, .18, .62, .8], repeat: Infinity, delay, ease: "easeInOut" as const },
    style: { background: colour, boxShadow: `0 0 34px -4px ${colour}` },
  });
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-md border border-brass/30 bg-black/25 p-3">
      <motion.span className="block h-9 w-9 rounded-full" {...lamp(false, "var(--cue-live)", 0)} />
      <motion.span className="block h-9 w-9 rounded-full" {...lamp(true, "var(--cue-ready)", 0)} />
    </div>
  );
}

const rise = (d = 0) => ({
  initial: { opacity: 0, y: 28 }, whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-90px" }, transition: { duration: .7, delay: d, ease: [.16, 1, .3, 1] as const },
});

/** Three beats, and they are a real sequence — this is the order you do it in. */
const beats = [
  { n: "1", head: "Load the book", line: "Sound, slides, video. One library." },
  { n: "2", head: "Set the running order", line: "Drag it into the order you will call it." },
  { n: "3", head: "Stand by, and go", line: "One key. One cue. Nothing before you say so." },
];

export default function Home() {
  return (
    <Page>
      <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_auto]">
        <div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8 }}
            className="font-mono text-[11px] uppercase tracking-[.42em] text-brass">
            The prompt corner, in a browser
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .08, ease: [.16, 1, .3, 1] }}
            className="mt-5 text-6xl font-bold leading-[.92] sm:text-8xl">
            Stand by.
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .6, delay: .9 }}
              className="block italic text-accent">Go.</motion.span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .22 }}
            className="mt-7 max-w-lg text-lg leading-relaxed text-muted">
            Every sound and every slide in your show, in one numbered list, fired by one key.
            The room hears it when you call it — never a second sooner.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .3 }}
            className="mt-10 flex flex-wrap items-center gap-3">
            <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-semibold">Open the Studio</Button>
            <Button href="/show" size="lg" variant="bordered">Join a show</Button>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .9, delay: .45 }}
          className="hidden lg:block">
          <CueLight />
        </motion.div>
      </section>

      {/* The prompt book: a hairline margin with the number pencilled beside it, which is where a
          cue number lives on paper and where it lives everywhere else in this app. */}
      <section className="border-y border-white/10 py-16">
        <div className="space-y-12">
          {beats.map((b, i) => (
            <motion.div key={b.n} {...rise(i * .08)} className="margin-rule max-w-2xl">
              <span className="cue-mark text-brass">{b.n}</span>
              <h2 className="text-3xl font-bold sm:text-4xl">{b.head}</h2>
              <p className="mt-2 text-lg text-muted">{b.line}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="py-20">
        <motion.blockquote {...rise()} className="mx-auto max-w-3xl text-center">
          <p className="text-3xl font-bold italic leading-snug sm:text-5xl">
            A desk decides what goes out and when.
            <span className="text-accent"> You should decide the when.</span>
          </p>
        </motion.blockquote>
      </section>

      <section className="pb-24">
        <motion.div {...rise()} className="glass px-8 py-14 text-center sm:px-12">
          <h2 className="text-4xl font-bold sm:text-5xl">Curtain up.</h2>
          <p className="mx-auto mt-4 max-w-md text-muted">Free, in the browser, nothing to install.</p>
          <Button className="mt-8 font-semibold" href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />}>Open the Studio</Button>
        </motion.div>
      </section>
    </Page>
  );
}
