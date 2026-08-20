# Cueflow Inspection Log

## Baseline

Repository revision: `a9a1b5a0dabdb5a7338d9efee4cc780c777c2a3f`

The locked dependencies installed successfully. The baseline test suite passed with 23 test files and 176 tests. The production build passed with TypeScript checking and Vite bundling. Vite reported only the existing large-chunk warning. `npm ci` reported existing dependency audit findings, including one critical vulnerability, but dependency upgrades are outside this frontend bug-fix scope.

## Confirmed issues

| ID | Area | Reproduction or evidence | Expected behavior | Priority | Status |
|---|---|---|---|---|---|
| T-01 | Tutorial spotlight | `Spotlight.tsx` renders a full-screen `motion.button` backdrop with `pointerEvents: auto`; its highlighted rectangle is the clickable backdrop element, so the underlying target cannot receive the click while the tutorial is open. | The highlighted target remains clickable while the instructional popup is visible. | P0 | Fixed |
| T-02 | Tutorial spotlight | `Spotlight.tsx` uses a rectangular ring with a fixed `borderRadius: 10`, so it does not accurately circle compact round controls and the pointer/connector requested by the tutorial is absent. | Each popup visibly identifies its target with a target-appropriate circle or spotlight and connector. | P1 | Fixed |
| T-03 | Tutorial positioning | Popup placement uses fixed constants `CARD = 336` and `TALL = 190`, while the actual card height is content-dependent. It can overlap the viewport or place the pointer inaccurately on small screens. | Popup placement remains within the viewport and aligned with the measured target. | P1 | Fixed |
| T-04 | Tutorial flow | `Tour.tsx` has no visible Next or Back controls and intentionally waits for the user to perform every step. The two `onPress` steps use `setTimeout(next, 350)` without checking whether the step is still active. | The intended tutorial sequence is complete, dismissible, and robust to rapid interaction and unmounting. | P1 | Fixed |
| T-05 | Tutorial route/anchor | `lib/tour.ts` defines the first anchor as a responsive selector pair and later anchors depend on conditional Studio UI. The flow can remain hidden when a target is not rendered, and the step metadata `route` is not used by `Tour.tsx` to navigate. | A step either reveals its existing target or safely resumes without an orphaned or inaccessible popup. | P1 | Fixed |
| T-06 | Dark mode scope | `DarkToggle.tsx` and `WorkSurface` scope `themeClass(theme)` to the Studio work surface. The surrounding Shell, sidebar, nav, and footer remain light by design, but the user reports incomplete coverage and global styles still contain light-only literals and utility retints that require a full audit. | Dark mode applies consistently across the intended full interface while preserving stage output exceptions. | P0 | Fixed |
| T-07 | Homepage mobile image | `styles.css` applies `.shot { aspect-ratio: 4 / 5; object-fit: cover; object-position: left top; }` on small screens. The last `beats` row uses `shot("phone")` as both desktop and mobile source, so the phone capture is placed into the generic cropped frame and appears zoomed. | The final mobile interface image is shown in a true 9:16 frame without unintended zoom or crop. | P0 | Fixed |
| T-08 | Theme and media regression risk | Several shared style rules use hard-coded `#fff`, black overlays, and `border-white/*` retints. Some are intentional for stage output, while others need classification rather than blanket replacement. | Intentional stage literals remain, while app surfaces use readable theme-aware tokens. | P1 | Fixed for inspected surfaces |

## Inspection boundary

No backend, authentication, data model, analytics, or external integration changes are indicated by the confirmed findings. Such changes will not be introduced unless source inspection proves an existing frontend feature cannot work without them.

## Runtime verification after first fix group

The exposed development build loaded the homepage and Studio without a runtime error. The Studio tutorial rendered with a target-aligned spotlight, a connector line, popup controls, and a highlighted New sequence button. Clicking New sequence while the popup remained open created Sequence 1 and advanced the tutorial to Step 4 of 9, confirming that the overlay no longer blocks the target control. The inspected viewport also showed the popup repositioning beside the newly selected Sequences target.

The homepage rendered the final phone asset from `/shots/phone.png`; the code now applies the dedicated `phone-shot` 9:16 class to that final beat while retaining the existing source asset and row structure.

## Runtime verification of dark mode

Settings rendered with the new `Dark mode` control. After toggling it, the browser view showed the page background, sticky navigation, sidebar, Settings cards, inputs, buttons, borders, and footer surface all switching to the warm dark palette together. The audience/stage exception remains separate by design. No runtime error appeared during this check. The final regression run passed 23 test files and 176 tests, the production build passed, and `git diff --check` reported no whitespace errors. Vite still reports its pre-existing large-chunk warning. The browser session was returned to light mode after validation so the inspection did not leave the user's local preference changed.

