import { motion } from "framer-motion";
import { ArrowRight, ListMusic, Monitor, Music, Presentation, Sparkles } from "lucide-react";
import Page from "../components/Page";
import { Button, Card, CardBody } from "../ui";

const highlights = [
  { icon: Presentation, title: "Sound, slides and video", body: "One library for audio, images, video and embedded decks. Edit any of them in the browser." },
  { icon: ListMusic, title: "One deck, mixed cues", body: "Audio 1, slide 1, audio 2, slide 2. Drag to reorder, choose the transition, drive it with your arrow keys." },
  { icon: Monitor, title: "A presenter window that shows up", body: "Black when the cue is sound alone, the slide or video itself the moment a visual cue fires." },
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
          Run your show like a <span className="bg-gradient-to-r from-accent to-secondary bg-clip-text text-transparent">slideshow</span>.
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }} className="mt-6 max-w-2xl text-lg text-muted">
          CueFlow is a browser cue board for theatre, presentations and streams: sound, slides and video in one deck, a waveform and media editor, and a presenter display, no downloads, no autoplay surprises.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .19 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
          <Button href="/tutorial" size="lg" variant="bordered">See how it works</Button>
        </motion.div>
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
