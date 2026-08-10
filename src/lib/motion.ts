import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

/**
 * Scroll-linked motion for the marketing pages. framer-motion still owns component enter/exit;
 * GSAP owns only what the scrollbar drives.
 *
 * House rules, all of them load-bearing:
 *  - transforms and opacity only (a cue board must stay at 60fps while this plays behind it);
 *  - every trigger is made inside `useGSAP({ scope })`, so a route change reverts it, react-router
 *    unmounts these pages and a ScrollTrigger on a dead node keeps firing otherwise;
 *  - `gsap.matchMedia()` with a reduce branch that sets the end state and animates nothing.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger);

type Scope = RefObject<HTMLElement | null>;

const REDUCE = "(prefers-reduced-motion: reduce)";
const MOTION = "(prefers-reduced-motion: no-preference)";

/**
 * Reveal-on-enter for a row of repeated things, mark them `data-reveal`.
 * One batched trigger for the whole row, not one per card.
 */
export function useReveal(scope: Scope) {
  useGSAP(() => {
    const els = gsap.utils.selector(scope)("[data-reveal]");
    if (!els.length) return;

    const mm = gsap.matchMedia();
    mm.add(REDUCE, () => { gsap.set(els, { autoAlpha: 1, y: 0 }); });
    mm.add(MOTION, () => {
      gsap.set(els, { autoAlpha: 0, y: 24 });
      ScrollTrigger.batch(els, {
        start: "top 88%",
        once: true,
        onEnter: batch => gsap.to(batch, {
          autoAlpha: 1, y: 0, duration: .5, stagger: .06, ease: "power2.out", overwrite: true,
          // hand the node back to CSS once it has arrived, so :hover transforms still bite
          clearProps: "transform,opacity,visibility",
        }),
      });
    });
    return () => mm.revert();
  }, { scope });
}

/**
 * The one held beat per page: pin `data-pin` and scrub `data-pin-inner` up to full while it is held.
 * Desktop only, pinning a short section on a phone is more jolt than effect.
 */
export function usePinScrub(scope: Scope) {
  useGSAP(() => {
    const q = gsap.utils.selector(scope);
    const pin = q("[data-pin]")[0];
    const inner = q("[data-pin-inner]")[0];
    if (!pin || !inner) return;

    const mm = gsap.matchMedia();
    mm.add(`${REDUCE}, (max-width: 767px)`, () => { gsap.set(inner, { autoAlpha: 1, y: 0 }); });
    mm.add(`${MOTION} and (min-width: 768px)`, () => {
      gsap.timeline({
        scrollTrigger: { trigger: pin, start: "center center", end: "+=55%", pin, scrub: .6 },
      }).fromTo(inner, { autoAlpha: .3, y: 18 }, { autoAlpha: 1, y: 0, ease: "none" });
    });
    return () => mm.revert();
  }, { scope });
}
