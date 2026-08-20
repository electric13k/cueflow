# Framer Motion scroll-animation research

## Official sources

1. [React scroll animation](https://motion.dev/docs/react-scroll-animations)
2. [useInView](https://motion.dev/docs/react-use-in-view)

## Findings applied to Cueflow

Motion distinguishes scroll-triggered effects from scroll-linked effects. `whileInView` is appropriate for declarative reveal states when an element enters the viewport. `useScroll` is appropriate for values directly linked to scroll progress, including progress indicators, parallax, and clip-path reveals.

The official scroll guide recommends using a target ref with `useScroll({ target, offset })` for local section progress. It also shows `useTransform` for mapping scroll progress into visual properties such as opacity, scale, translation, and clip paths. The guide emphasizes that parallax layers should move at different speeds and that scroll-linked effects should remain limited to useful visual depth rather than replacing normal layout.

The official `useInView` guide documents `once: true` for one-time reveals, `amount` for controlling how much of an element must enter the viewport, `margin` for adjusting the detection window, and `initial` for avoiding an initial hidden state while measurement is pending. Cueflow should use these options to keep reveals stable and predictable.

## Implementation direction

Preserve Cueflow's existing GSAP reveal and CSS scroll timeline behavior. Add Motion-based section-level reveals or subtle local scroll-linked effects only where they improve hierarchy, using `useReducedMotion` or reduced-motion-safe CSS so accessibility behavior remains intact. Avoid animating layout-affecting properties, avoid large continuous transforms on dense mobile layouts, and keep the existing warm visual language.

## Local browser verification

The local homepage loaded successfully. The existing hero entrance remained intact. Feature rows now reveal their copy and frame children with separate Motion viewport triggers while GSAP continues to own the parent row reveal. Each frame includes a subtle accent scanline driven by local `useScroll` progress. The final phone feature uses a centered constrained frame rather than a full-width image. The browser view showed no runtime error while scrolling through the feature rows.

A follow-up browser snapshot at the scrolled position showed the navigation and progress line but the main content was visually blank, even though the extracted page text still contained the homepage sections. This may be a transient animation state or an interaction between the existing GSAP parent reveal and the new child Motion reveal, so it requires code-level inspection before deployment.

After the initial hero transition settled, the homepage rendered normally. Scrolling to the page end kept the existing pinned quote and footer visible, and the top progress trace remained aligned below the navigation. No persistent blank state or runtime error was reproduced in the settled view.
