import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Radio } from "lucide-react";
import LogoMark from "../components/LogoMark";
import Page from "../components/Page";
import { useReveal, usePinScrub } from "../lib/motion";
import { useStudioTheme, type Theme } from "../lib/theme";
import { Button } from "../ui";

/**
 * The homepage shows the product rather than describing it. Every claim is one line long and sits
 * next to the screen that proves it, because a stranger deciding whether this is for them is
 * looking, not reading, and a paragraph they skip is a paragraph that cost the page its rhythm.
 *
 * One button. The page used to offer three at the top and two at the bottom, which is five ways to
 * ask the same question and no answer about which one is the way in.
 */
const PNG_SHOTS = new Set(["soundboard", "sequences", "editor", "phone", "phone-deck", "phone-editor", "studio-mockup-desktop", "studio-mockup-phone"]);
const shot = (name: string, theme: Theme) => {
  const ext = PNG_SHOTS.has(name) || name.endsWith("-new") || name.startsWith("studio-mockup") ? "png" : "svg";
  return `${import.meta.env.BASE_URL}shots/${name}-${theme}.${ext}`;
};

/**
 * What it is, why it beats four windows, what you watch while it runs, who else is holding a screen.
 *
 * Each has two graphic compositions, not one scaled graphic. Wide artwork stays wide and portrait
 * artwork stays portrait, so the mobile frame reads as an intentional vertical illustration rather
 * than a cropped desktop scene.
 */
const beats = [
  {
    n: "1",
    head: "One list. Every sound, every slide.",
    line: "In the order you will call them, numbered the way you will call them.",
    src: "soundboard",
    phone: "phone",
    alt: "CueFlow’s Soundboard screen with numbered media cards arranged for a live production",
  },
  {
    n: "2",
    head: "One key instead of four windows.",
    line: "Arrows step the deck. A and D move the slide without touching the sound.",
    src: "sequences",
    phone: "phone-deck",
    alt: "CueFlow’s sequence deck showing ordered cues and the next item standing by",
  },
  {
    n: "3",
    head: "On now, and standing by.",
    line: "The whole readout, on every device in the room.",
    src: "editor",
    phone: "phone-editor",
    alt: "CueFlow’s editor workspace with a media preview, timeline, and controls for rehearsal",
  },
  {
    n: "4",
    head: "The crew join on their phones.",
    line: "Hand out a key. No install, nothing to hand back at the end.",
    src: "studio-mockup-desktop",
    phone: "studio-mockup-phone",
    alt: "CueFlow Studio showing the library, show controls, and script surface in one browser workspace",
  },
];

type Beat = (typeof beats)[number];

function BeatRow({ beat, theme }: { beat: Beat; theme: Theme }) {
  const src = shot(beat.src, theme);
  const phone = shot(beat.phone, theme);
  const phoneFrameClass = "mobile-visual-frame";
  const phoneImageClass = "responsive-shot";
  const rowRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: rowRef,
    offset: ["start 88%", "end 28%"],
  });
  const scanProgress = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
      <div ref={rowRef} data-reveal
      className="beat grid items-center gap-8 border-b border-white/10 py-16 sm:py-20 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
      {/* GSAP owns the row reveal. Motion owns these child reveals and the local scanline, so no node
          has two scroll owners fighting over the same opacity or transform. */}
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: .45, margin: "0px 0px -10% 0px" }}
        transition={{ duration: .48, ease: [.16, 1, .3, 1] }}
        className="margin-rule">
        <span className="cue-mark text-brass">{beat.n}</span>
        <h2 className="text-3xl font-bold leading-tight sm:text-4xl">{beat.head}</h2>
        <p className="mt-3 text-muted">{beat.line}</p>
      </motion.div>
      <motion.figure
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24, scale: .985 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
        whileHover={prefersReducedMotion ? undefined : { y: -7, scale: 1.012 }}
        whileTap={prefersReducedMotion ? undefined : { scale: .995 }}
        viewport={{ once: true, amount: .22, margin: "0px 0px -8% 0px" }}
        transition={{ duration: .68, delay: .08, ease: [.16, 1, .3, 1] }}
        className={`glass shot-frame relative overflow-hidden p-2 ${phoneFrameClass}`}>
        <picture>
          <source media="(max-width: 639px)" srcSet={phone} />
          <img key={src} src={src} alt={beat.alt} loading="lazy" width={beat.n === "4" ? 900 : 1600} height={beat.n === "4" ? 1600 : 900}
            className={`shot themed-shot ${phoneImageClass} parallax-on-scroll rounded-2xl bg-black/30`} />
        </picture>
        <span aria-hidden className="beat-halo" />
        <motion.span aria-hidden className="beat-scanline"
          style={{ scaleX: prefersReducedMotion ? 1 : scanProgress }} />
      </motion.figure>
    </div>
  );
}

export default function Home() {
  // Triggers are made top to bottom in page order: the explanation rows, then the held line under them.
  const root = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [theme] = useStudioTheme();
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroGridY = useTransform(heroProgress, [0, 1], [0, 72]);
  const heroGridRotate = useTransform(heroProgress, [0, 1], [0, 8]);
  useReveal(root);
  usePinScrub(root);
  return (
    <Page>
      <div ref={root}>
        <section ref={heroRef} className="relative overflow-hidden py-14 sm:py-20">
          <motion.div aria-hidden className="hero-grid pointer-events-none absolute inset-0"
            style={{ y: prefersReducedMotion ? 0 : heroGridY, rotate: prefersReducedMotion ? 0 : heroGridRotate }}
            animate={prefersReducedMotion ? undefined : { backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }} />
          <motion.span aria-hidden className="hero-orbit pointer-events-none absolute left-[58%] top-24 hidden h-44 w-44 rounded-full border border-accent/20 lg:block"
            animate={prefersReducedMotion ? undefined : { rotate: 360 }} transition={{ duration: 22, repeat: Infinity, ease: "linear" }} />
          <div className="relative z-10">
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, scale: .8, rotate: -12 }} animate={prefersReducedMotion ? undefined : { opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: .7, ease: [.16, 1, .3, 1] }}>
            <LogoMark size={40} />
          </motion.div>
          <motion.h1 initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }} animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: .8, delay: .1, ease: [.16, 1, .3, 1] }}
            className="mt-6 max-w-4xl text-[2.75rem] font-bold leading-[.95] sm:text-7xl">
            Run the whole show off one key.
          </motion.h1>
          <motion.p initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: .7, delay: .24 }}
            className="mt-5 max-w-xl text-xl leading-snug text-muted sm:text-2xl">
            A cue board in a browser tab. Build the order once, stand by, press once.
          </motion.p>

          {/* One way in. The Studio and the tutorial are a tap away in the bar and the footer, and a
              visitor who wants those is not the visitor this button is for. */}
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: .7, delay: .34 }}
            className="mt-9">
            <Button href="/studio" color="primary" size="lg" startContent={<Radio size={18} />} className="cue-leather font-semibold">
              Open the Studio
            </Button>
          </motion.div>

          <motion.figure initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }} animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }} whileHover={prefersReducedMotion ? undefined : { y: -5 }} transition={{ duration: .9, delay: .42, ease: [.16, 1, .3, 1] }}
            className="glass shot-frame mobile-visual-frame hero-mockup-frame mt-14 overflow-hidden p-2">
            <picture>
              <source media="(max-width: 639px)" srcSet={shot("studio-mockup-phone", theme)} />
              <img key={shot("studio-mockup-desktop", theme)} src={shot("studio-mockup-desktop", theme)} width={2560} height={1440} loading="eager"
                alt="CueFlow Studio displayed inside a desktop monitor mockup with the Library and cue board visible"
                className="shot themed-shot responsive-shot hero-mockup parallax-on-scroll rounded-2xl bg-black/30" />
            </picture>
          </motion.figure>
          </div>
        </section>

        <section className="border-t border-white/10">
          {/* GSAP's useReveal already drives these rows and works in every browser, so they do not
              also get .enter-on-scroll: two things animating one node's opacity is one too many. The
              CSS timeline is used on the pages that have no GSAP reveal. */}
          {beats.map(b => <BeatRow key={b.n} beat={b} theme={theme} />)}
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
            <Button href="/studio" color="primary" size="lg" startContent={<Radio size={18} />} className="cue-leather font-semibold">
              Open the Studio
            </Button>
          </div>
        </section>
      </div>
    </Page>
  );
}
