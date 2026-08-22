# Motion and cinematic reference notes

## Motion source

Motion’s official React scroll guide distinguishes scroll-triggered animation from scroll-linked animation. It recommends `whileInView` and `viewport={{ once: true }}` for entrance reveals, `useScroll` with `target` and `offset` for element progress, `useTransform` for mapping progress to visual properties such as color or clip-path, and `useSpring` for smoothing scroll-linked values. It notes that scroll-triggered effects use pooled IntersectionObserver and that scroll-linked effects use native ScrollTimeline where available.

Source: https://motion.dev/docs/react-scroll-animations

## User-provided cinematic reference

Reference video: https://www.youtube.com/watch?v=Zqj6JEAcaiw

Observed techniques from analysis: a 16:9 floating application canvas with rounded corners and shadow, branded background treatment, smooth cursor-following zooms and dolly moves, occasional subtle 3D tilt, enlarged or color-treated cursor, click ripples, spotlight masks, magnifier or loupe emphasis, selective blur, sparse motion-blurred transitions, and sound cues synchronized to interface actions. Cueflow adaptation should use its own burgundy, brass, emerald, warm paper, and charcoal palette, authentic app content, restrained 2D movement where clarity matters, and original audio and annotations. Do not copy the reference’s branding or content.
