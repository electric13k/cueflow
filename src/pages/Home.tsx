import { Link } from "react-router-dom";
import { Button, Card, CardBody } from "@heroui/react";
import { motion } from "framer-motion";
import { ArrowRight, Cloud, Download, Keyboard, ListMusic, Monitor, Music, SlidersHorizontal, Sparkles, Zap } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";

const features = [
  { icon: Cloud, title: "Cloud sound library", body: "Upload your own audio or import from Myinstants. Files persist in cloud storage, metadata in your browser." },
  { icon: SlidersHorizontal, title: "Web Audio editor", body: "Non-destructive speed, volume, gain, reverb, fade in/out, distortion and reverse — saved per sound." },
  { icon: ListMusic, title: "Manual cue sequences", body: "Build slideshow-style decks that never autoplay. Repeat a sound with different settings per cue." },
  { icon: Keyboard, title: "Arrow-key playback", body: "Drive a show like a presenter: ← → step through cues, pause/play, ±5s scrub." },
  { icon: Monitor, title: "Blackout presenter mode", body: "A pure-black audience window for the mirrored screen — the room sees nothing while you run the board." },
  { icon: Zap, title: "Live effects in playback", body: "Tune reverb, speed, volume and fades on the fly, not just in the editor." },
];

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

export default function Home() {
  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <section className="grid place-items-center py-20 text-center sm:py-28">
          <motion.div initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .5 }} className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[.28em] text-primary">
            <Sparkles size={13} /> Live audio cue system
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .05 }} className="mt-6 max-w-4xl text-5xl font-black leading-[1.03] tracking-tight sm:text-7xl">
            Run your sound like a <span className="bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-transparent">slideshow</span>.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .12 }} className="mt-6 max-w-2xl text-lg text-default-500">
            CueFlow is a browser soundboard for theatre, presentations and streams: a Web Audio editor, arrow-key cue sequences, and a blackout presenter display — no downloads, no autoplay surprises.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .19 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-primary/30">Open the Studio</Button>
            <Button as="a" href="#features" size="lg" variant="bordered">See features</Button>
          </motion.div>
        </section>

        <section id="features" className="scroll-mt-20 py-10">
          <motion.h2 {...fade()} className="text-center text-3xl font-black tracking-tight sm:text-4xl">Everything a cue board needs</motion.h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div key={f.title} {...fade(i * .05)}>
                <Card className="glass glass-hover h-full bg-transparent"><CardBody className="gap-3 p-6">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary"><f.icon size={22} /></div>
                  <h3 className="text-lg font-bold">{f.title}</h3>
                  <p className="text-sm text-default-500">{f.body}</p>
                </CardBody></Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="py-16">
          <motion.div {...fade()}>
            <Card className="overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/15 to-content1/40">
              <CardBody className="grid items-center gap-6 p-8 sm:grid-cols-[1fr_auto] sm:p-12">
                <div>
                  <h2 className="text-3xl font-black tracking-tight">Ready to build your first show?</h2>
                  <p className="mt-3 max-w-xl text-default-500">Upload a few sounds, drop them into a sequence, and drive it with your arrow keys. It's all client-side and free.</p>
                </div>
                <Button href="/studio" color="primary" size="lg" endContent={<Music size={18} />} className="font-bold shadow-lg shadow-primary/30">Launch Studio</Button>
              </CardBody>
            </Card>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-default-100 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-default-500 sm:px-6 lg:px-8">
          <span className="flex items-center gap-2"><Download size={14} /> CueFlow — React · HeroUI · Supabase · WebGL</span>
          <Link to="/studio" className="font-semibold text-primary">Open Studio →</Link>
        </div>
      </footer>
    </div>
  );
}
