import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bootDevice } from "../lib/boot";
import { bakedShowOpened } from "../lib/bakedShow";
import { toast } from "../lib/toast";
import { onOpenedShow } from "../lib/openedShow";

/**
 * Takes somebody straight to the show their installer was built around.
 *
 * Renders nothing. It exists because the import itself has to run before React does, so that the
 * Studio and the show screen read a device that already has its shows on it, and the navigation
 * afterwards has to run inside the router, which does not exist yet at that point.
 *
 * Only on a first start that actually imported something. `bootDevice` returns an id exactly once,
 * on the run that wrote the show; on every start after that it answers null and this does nothing,
 * so the app opens wherever the operator left it rather than dragging them back to the show screen
 * every morning.
 */
export default function BakedShow() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let alive = true;
    void bootDevice().then(showId => {
      if (!alive || !showId) return;
      const opened = bakedShowOpened();
      // Somewhere other than the front door means they navigated while the disk was being read.
      // Following them there is right; yanking the screen out from under them is not.
      if (pathname !== "/" && pathname !== "/studio") return;
      toast(
        "This app is a show",
        opened?.role
          ? `It opened ${opened.role}. Everything it needs is already on this device, so there is nothing to type and nothing to download.`
          : "The whole show came with it: the cues, the sequences and every file. Nothing to type, nothing to download.",
        "success",
      );
      // A copy cut for a job goes to the show screen, because that is the screen that job works on.
      // A copy carrying the whole show goes to the Studio, because whoever holds it is building it.
      navigate(opened?.role ? "/show" : "/studio", { replace: true });
    });
    /*
     * A show file opened from the desktop lands wherever the app happens to be. The screen that
     * reviews an import lives on /show, so go there; the file itself is parked and collected by
     * that screen, so nothing is passed through the router.
     */
    const stop = onOpenedShow(() => navigate("/show", { replace: false }));

    return () => { alive = false; stop(); };
    // Once per load. The path is read at the moment the answer arrives, not subscribed to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
