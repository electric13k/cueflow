import { motion } from "framer-motion";
import { ArrowRight, ListMusic, Monitor, Music, Presentation, Sparkles } from "lucide-react";
import Page from "../components/Page";
import { Button, Card, CardBody } from "../ui";

const highlights = [
  { icon: Presentation, title: "Sound, slides and video", body: "One library for audio, images, video and embedded decks, with an editor for each. Nothing leaves your browser to be processed." },
  { icon: ListMusic, title: "One deck, two runs of numbers", body: "Sound counts 1, 2, 3. Anything the room sees counts a, b, c. “Play 3” and “put up b” can never be confused over comms." },
  { icon: Monitor, title: "A presenter window that shows up", body: "Black when the cue is sound alone, the slide or video itself the moment a visual cue fires." },
];

/** The mental model, in the order you meet it. Three steps, because that is all there is to it. */
const steps = [
  { n: "1", title: "Put everything in the library", body: "Upload it, paste a link, or search the open archives. Trim the sound, crop the picture, type a slide — all of it here, none of it uploaded to be processed." },
  { n: "2", title: "Line the cues up in order", body: "Drag them into the running order for your show. Link a slide to the sound underneath it and one keypress fires both." },
  { n: "3", title: "Arm it, then drive it", body: "The screen turns amber to say it is loaded, and stays that way until you press an arrow. Every cue goes out because you sent it, not because a timer said so." },
];

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

export default function Home() {
  return (
    <Page>
      <section className="grid place-items-center py-16 text-center sm:py-24">
        <motion.div initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .5 }} className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[.28em] text-accent">
          <Sparkles size={13} /> Live cue system
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .05 }} className="mt-6 max-w-4xl text-5xl font-black leading-[1.03] tracking-tight sm:text-7xl">
          Nothing happens until <span className="bg-gradient-to-r from-accent to-secondary bg-clip-text text-transparent">you press the key</span>.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }} className="mt-6 max-w-2xl text-lg text-muted">
          CueFloww is a cue board you run from a laptop. Your sound, slides and video go into one numbered list; each keypress fires the next thing on it, onto a second screen the audience sees. No desk, no install, and nothing plays on its own.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .19 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
          <Button href="/tutorial" size="lg" variant="bordered">See how it works</Button>
        </motion.div>
      </section>

      <section className="py-10">
        <motion.h2 {...fade()} className="text-center text-3xl font-black tracking-tight sm:text-4xl">What it actually is</motion.h2>
        <motion.p {...fade(.05)} className="mx-auto mt-4 max-w-2xl text-center text-muted">
          A theatre desk decides <em>what</em> goes out and <em>when</em>. CueFloww takes the first half and gives the
          second half back to you — it holds the running order, and you call it.
        </motion.p>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div key={s.n} {...fade(i * .06)} className="glass-soft p-6">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 font-mono text-sm font-black text-accent">{s.n}</span>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="features" className="scroll-mt-20 py-10">
        <motion.h2 {...fade()} className="text-center text-3xl font-black tracking-tight sm:text-4xl">Everything a cue board needs</motion.h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((f, i) => (
            <motion.div key={f.title} {...fade(i * .05)}>
              <Card className="glass glass-hover h-full bg-transparent"><CardBody className="gap-3 p-6">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/15 text-accent"><f.icon size={22} /></div>
                <h3 className="text-lg font-bold">{f.title}</h3>
                <p className="text-sm text-muted">{f.body}</p>
              </CardBody></Card>
            </motion.div>
          ))}
        </div>
        <motion.div {...fade(.2)} className="mt-8 text-center">
          <Button href="/features" variant="bordered" endContent={<ArrowRight size={16} />}>See the full feature list</Button>
        </motion.div>
      </section>

      <section className="py-16">
        <motion.div {...fade()}>
          <Card className="glass overflow-hidden border-accent/20 bg-gradient-to-br from-accent/15 to-secondary/10">
            <CardBody className="grid items-center gap-6 p-8 sm:grid-cols-[1fr_auto] sm:p-12">
              <div>
                <h2 className="text-3xl font-black tracking-tight">Ready to build your first show?</h2>
                <p className="mt-3 max-w-xl text-muted">Upload a few sounds, add a slide, drop them into a sequence, and drive it with your arrow keys. Sign in and it all saves to your account.</p>
              </div>
              <Button href="/studio" color="primary" size="lg" endContent={<Music size={18} />} className="font-bold shadow-lg shadow-accent/30">Launch Studio</Button>
            </CardBody>
          </Card>
        </motion.div>
      </section>
    </Page>
  );
}
