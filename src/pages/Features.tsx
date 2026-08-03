import { motion } from "framer-motion";
import { ArrowRight, Cloud, Film, Image, Keyboard, ListMusic, Monitor, Presentation, Search, SlidersHorizontal, Zap } from "lucide-react";
import Page from "../components/Page";
import { Button, Card, CardBody } from "../ui";

const fade = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: .5, delay: d } });

const groups = [
  {
    title: "Get media in",
    items: [
      { icon: Cloud, title: "Upload anything", body: "Audio, images and video from your device, stored in the cloud and saved to your account. Imports are renamed automatically, so a file called airhorn-2_final.mp3 lands as “Airhorn 2 Final”." },
      { icon: Search, title: "Search where you like", body: "One search bar with a source picker: filter your own library, or search the Internet Archive and Wikimedia Commons for freely licensed recordings. Myinstants opens in a tab; paste any direct link to import it." },
      { icon: Presentation, title: "Slides and decks", body: "Make a blank 16:9 slide and type on it, drop in exported slide images, or paste a Google Slides or PowerPoint Online link to embed the deck itself." },
    ],
  },
  {
    title: "Shape it",
    items: [
      { icon: SlidersHorizontal, title: "Waveform editor", body: "Cut, copy, paste, merge and silence a region, mix to mono, balance left and right, plus speed, reverb, fades, distortion and reverse. Hear the edit before you save it." },
      { icon: Image, title: "Image and slide editor", body: "Framing, zoom, rotation, mirroring, brightness, contrast, saturation, blur and a caption. Non-destructive, or flatten the look into a new image." },
      { icon: Film, title: "Video editor", body: "Trim in and out, set the speed, mute it, loop the trimmed section. Nothing is re-encoded, so the cue is ready the moment you set it." },
    ],
  },
  {
    title: "Run the show",
    items: [
      { icon: ListMusic, title: "Mixed cue decks", body: "One deck holds sound, slides and video together: audio 1, slide 1, audio 2, slide 2. Drag to reorder, pick a transition per cue." },
      { icon: Monitor, title: "Presenter display", body: "A second window for the projector. Black on audio-only cues, the slide or video itself when a visual cue fires, with the transition you chose." },
      { icon: Keyboard, title: "Arrows and WASD", body: "Arrow keys step every cue; A and D step slides only, so the deck moves without touching the sound underneath. W and S zoom the stage. Every key is rebindable, and they work from either window." },
      { icon: Zap, title: "Live effects", body: "Tune reverb, speed, volume and fades on the fly during playback, not just in the editor." },
    ],
  },
];

export default function Features() {
  return (
    <Page>
      <motion.p {...fade()} className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Features</motion.p>
      <motion.h1 {...fade(.05)} className="mt-2 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">A cue board for sound, slides and video.</motion.h1>
      <motion.p {...fade(.1)} className="mt-4 max-w-2xl text-lg text-muted">
        Everything runs in the browser. Nothing autoplays, nothing is installed, and your show is driven from the keyboard.
      </motion.p>

      {groups.map((g, gi) => (
        <section key={g.title} className="py-10">
          <motion.h2 {...fade()} className="text-2xl font-black tracking-tight">{g.title}</motion.h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((f, i) => (
              <motion.div key={f.title} {...fade(i * .05 + gi * .02)}>
                <Card className="glass glass-hover h-full bg-transparent"><CardBody className="gap-3 p-6">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/15 text-accent"><f.icon size={22} /></div>
                  <h3 className="text-lg font-bold">{f.title}</h3>
                  <p className="text-sm text-muted">{f.body}</p>
                </CardBody></Card>
              </motion.div>
            ))}
          </div>
        </section>
      ))}

      <motion.div {...fade()} className="glass mt-4 flex flex-wrap items-center justify-between gap-4 border-accent/20 bg-gradient-to-br from-accent/15 to-secondary/10 p-8">
        <div>
          <h2 className="text-2xl font-black tracking-tight">Build a deck in five minutes.</h2>
          <p className="mt-2 text-muted">Upload a sound, add a slide, drop both into a sequence.</p>
        </div>
        <Button href="/studio" color="primary" size="lg" endContent={<ArrowRight size={18} />} className="font-bold shadow-lg shadow-accent/30">Open the Studio</Button>
      </motion.div>
    </Page>
  );
}
