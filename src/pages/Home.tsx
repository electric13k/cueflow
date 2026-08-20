import { useRef } from "react";
import { motion } from "framer-motion";
import { Radio } from "lucide-react";
import LogoMark from "../components/LogoMark";
import Page from "../components/Page";
import { useReveal, usePinScrub } from "../lib/motion";
import { Button } from "../ui";

/**
 * The homepage shows the product rather than describing it. Every claim is one line long and sits
 * next to the screen that proves it, because a stranger deciding whether this is for them is
 * looking, not reading, and a paragraph they skip is a paragraph that cost the page its rhythm.
 *
 * One button. The page used to offer three at the top and two at the bottom, which is five ways to
 * ask the same question and no answer about which one is the way in.
 */
const shot = (name: string) => `${import.meta.env.BASE_URL}shots/${name}.png`;

/**
 * What it is, why it beats four windows, what you watch while it runs, who else is holding a screen.
 *
 * Each has two pictures, not one scaled picture. A 1440x900 capture cropped to a phone frame is a
 * zoom, and a zoom of a desktop layout is not evidence that the phone layout exists. `phone` is a
 * real 390x844 capture of the phone layout, which runs a different arrangement rather than a
 * narrower one.
 */
const beats = [
  {
    n: "1",
    head: "One list. Every sound, every slide.",
    line: "In the order you will call them, numbered the way you will call them.",
    src: shot("sequences"),
    phone: shot("phone-deck"),
    alt: "The CueFlow deck: numbered cues, sound and screens in one order",
  },
  {
    n: "2",
    head: "One key instead of four windows.",
    line: "Arrows step the deck. A and D move the slide without touching the sound.",
    src: shot("soundboard"),
    phone: shot("phone"),
    alt: "The CueFlow library: a grid of media cards above the transport bar",
  },
  {
    n: "3",
    head: "On now, and standing by.",
    line: "The whole readout, on every device in the room.",
    src: shot("editor"),
    phone: shot("phone-editor"),
    alt: "The CueFlow editor showing a rendered waveform and its controls",
  },
  {
    n: "4",
    head: "The crew join on their phones.",
    line: "Hand out a key. No install, nothing to hand back at the end.",
    src: shot("phone"),
    phone: shot("phone"),
    alt: "CueFlow running on a phone",
  },
];

export default function Home() {
  // Triggers are made top to bottom in page order: the explanation rows, then the held line under them.
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  usePinScrub(root);
  return (
    <Page>
      <div ref={root}>
        <section className="py-14 sm:py-20">
          <motion.div initial={{ opacity: 0, scale: .8, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: .7, ease: [.16, 1, .3, 1] }}>
            <LogoMark size={40} />
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .1, ease: [.16, 1, .3, 1] }}
            className="mt-6 max-w-4xl text-[2.75rem] font-bold leading-[.95] sm:text-7xl">
            Run the whole show off one key.
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .24 }}
            className="mt-5 max-w-xl text-xl leading-snug text-muted sm:text-2xl">
            A cue board in a browser tab. Build the order once, stand by, press once.
          </motion.p>

          {/* One way in. The Studio and the tutorial are a tap away in the bar and the footer, and a
              visitor who wants those is not the visitor this button is for. */}
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .34 }}
            className="mt-9">
            <Button href="/studio" color="primary" size="lg" startContent={<Radio size={18} />} className="font-semibold">
              Open the Studio
            </Button>
          </motion.div>

          <motion.figure initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .9, delay: .42, ease: [.16, 1, .3, 1] }}
            className="glass shot-frame mt-14 overflow-hidden p-2">
            <picture>
              <source media="(max-width: 639px)" srcSet={shot("phone-deck")} />
              <img src={shot("sequences")} width={1600} height={900} loading="eager"
                alt="The CueFlow deck with a sequence armed: numbered cues, the armed one framed in amber"
                className="shot parallax-on-scroll rounded-2xl bg-black/30" />
            </picture>
          </motion.figure>
        </section>

        <section className="border-t border-white/10">
          {/* GSAP's useReveal already drives these rows and works in every browser, so they do not
              also get .enter-on-scroll: two things animating one node's opacity is one too many. The
              CSS timeline is used on the pages that have no GSAP reveal. */}
          {beats.map(b => (
            <div key={b.n} data-reveal
              className="beat grid items-center gap-6 border-b border-white/10 py-12 sm:py-16 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-14">
              <div className="margin-rule">
                <span className="cue-mark text-brass">{b.n}</span>
                <h2 className="text-3xl font-bold leading-tight sm:text-4xl">{b.head}</h2>
                <p className="mt-3 text-muted">{b.line}</p>
              </div>
              {/* The frame is clipped and the picture inside it travels, so the parallax moves no
                  layout, and the hover zoom has something to be clipped by. */}
              <figure className="glass shot-frame overflow-hidden p-2">
                <picture>
                  <source media="(max-width: 639px)" srcSet={b.phone} />
                  <img src={b.src} alt={b.alt} loading="lazy" width={1600} height={900}
                    className={`shot ${b.n === "4" ? "phone-shot" : ""} parallax-on-scroll rounded-2xl bg-black/30`} />
                </picture>
              </figure>
            </div>
          ))}
        </section>

        {/* Held for half a screen, the way a house light fade is held. Nothing moves but opacity. */}
        <section data-pin className="py-24">
          <blockquote data-pin-inner className="max-w-3xl">
            <p className="text-3xl font-bold italic leading-snug sm:text-5xl">
              A desk decides what goes out and when.
              <span className="text-accent"> You should decide the when.</span>
            </p>
          </blockquote>
        </section>

        <section className="pb-24">
          <div data-reveal className="glass flex flex-wrap items-center justify-between gap-6 px-8 py-14">
            <h2 className="text-4xl font-bold sm:text-5xl">Curtain up.</h2>
            <Button href="/studio" color="primary" size="lg" startContent={<Radio size={18} />} className="font-semibold">
              Open the Studio
            </Button>
          </div>
        </section>
      </div>
    </Page>
  );
}
