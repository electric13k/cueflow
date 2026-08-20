# Tutorial inspection

## Reproduced behavior

The local Studio tutorial rendered a popup for the sequence step, but the target geometry was too broad when selectors matched nested elements such as the `data-tour="deck-tab"` span. The spotlight implementation measured the selector match itself rather than resolving its closest actionable button or tab.

The tutorial's library step pointed at `data-coach="add"`, which is the Upload label, even though the instruction says to press a demo library card. The cues step pointed at the tab rather than the Add cue button. The fire step pointed at the entire mobile transport or armed banner instead of the first actual cue button.

A click on the highlighted New sequence button did work and advanced the tutorial, but the visual target and step semantics were not precise. The Settings page exposes `Run the tutorial again` as the clean regression entry point.

## Fix direction

Resolve selector matches to their closest actionable element, prefer the visible responsive match, and scroll an offscreen target into a stable centered viewport position before measuring it. Add explicit anchors to the work navigation, first library card, Add cue button, desktop first cue button, and mobile fire button. Keep the existing popup, step order, and surrounding UI unchanged.

After adding route guards, reloading Settings no longer left the tutorial popup over the Settings page. The Settings surface remained unobscured, and `Run the tutorial again` stayed available as the restart entry point.

The latest local Studio snapshot shows the cues-step spotlight wrapped around the compact `Sequence 1` button, not the full tab strip. The popup sits beneath and to the right of the target with a connector line. A follow-up browser click was interrupted by the browser extension losing its connection, so the post-click Add cue remount was validated from the observer design and build checks rather than that single click attempt.

Vercel's authenticated dashboard showed the Cueflow project updated to commit `8e8d482` with the message `Fix tutorial spotlight targeting` approximately one minute after the push.

Cloudflare Pages confirmed a successful Production deployment from commit `8e8d482` at `https://f1139f65.cueflow.pages.dev`, with the canonical domain `https://cueflow.pages.dev` active and automatic deployments enabled.

Vercel's project dashboard continued to show `Fix tutorial spotlight targeting` from `electric13k/cueflow` as the latest Cueflow project deployment entry, approximately two minutes after the push. The production domain remained `https://cuefloww.vercel.app` and returned HTTP 200 during the host check.
