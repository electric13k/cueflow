import { useCallback, useEffect, useState } from "react";
import { CloudDownload, Trash2, WifiOff } from "lucide-react";
import { Button } from "../ui";
import { canKeepOffline, forgetOffline, keepOffline, mediaForShow, offlineHave } from "../lib/offline";
import { toast } from "../lib/toast";
import type { Sequence, Track } from "../types";

/**
 * Take a show to a venue that has no network.
 *
 * The app shell has been cached for a while, so the page opens offline. The sounds were not: they
 * live on the storage host, a different origin, and the worker ignored anything cross-origin. An
 * operator who lost the wifi got a Studio that opened perfectly and could not make a noise, which
 * is worse than one that plainly refuses to start, because you find out at the wrong moment.
 *
 * Explicit rather than automatic. A library can be gigabytes, and quietly filling somebody's phone
 * is not a favour -- so this asks for the files this show needs, and says how many it has.
 */
export default function OfflineShow({ sequences, tracks }: { sequences: Sequence[]; tracks: Track[] }) {
  const wanted = mediaForShow(sequences, tracks);
  const [held, setHeld] = useState<number | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);

  const check = useCallback(() => {
    if (!canKeepOffline()) { setHeld(null); return; }
    void offlineHave(wanted).then(have => setHeld(have.length));
  }, [wanted.join("\n")]);

  useEffect(check, [check]);

  if (!canKeepOffline()) return null;

  const download = async () => {
    setBusy({ done: 0, total: wanted.length });
    const result = await keepOffline(wanted, p => setBusy({ done: p.done, total: p.total }));
    setBusy(null);
    check();
    if (result.failed.length) {
      toast(
        "Some cues are not ready",
        `${result.stored} of ${wanted.length} are on this device. The rest could not be fetched -- an upload that has not finished will do this.`,
        "warn",
      );
    } else {
      toast("Ready to run offline", `${result.stored} file${result.stored === 1 ? "" : "s"} held on this device.`, "success");
    }
  };

  const drop = async () => {
    await forgetOffline();
    check();
    toast("Space given back", "The held cues have gone. They will still play with a connection.", "info");
  };

  const ready = held !== null && wanted.length > 0 && held === wanted.length;

  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-3">
      <h3 className="label-cap flex items-center gap-1.5 text-muted"><WifiOff size={13} aria-hidden />Running with no network</h3>
      {wanted.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Nothing to hold yet. Sounds land here once they have finished uploading.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            {busy
              ? `Fetching ${busy.done} of ${busy.total}…`
              : ready
                ? `All ${wanted.length} cues are on this device.`
                : `${held ?? 0} of ${wanted.length} cues are on this device.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" color={ready ? "default" : "primary"} isDisabled={!!busy} isLoading={!!busy}
              startContent={<CloudDownload size={14} aria-hidden />} onPress={() => void download()}>
              {ready ? "Check again" : "Keep this show on this device"}
            </Button>
            {(held ?? 0) > 0 && (
              <Button size="sm" variant="light" isDisabled={!!busy}
                startContent={<Trash2 size={14} aria-hidden />} onPress={() => void drop()}>Give the space back</Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
