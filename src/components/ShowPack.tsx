import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Download, HardDriveDownload, Package, Upload } from "lucide-react";
import { Button, Spinner } from "../ui";
import { toast } from "../lib/toast";
import { size } from "../lib/compress";
import { local } from "../lib/store";
import { scopedKey, currentProject } from "../lib/projects";
import { loadScript } from "../lib/script";
import { linksOf, loadLinks } from "../lib/showLinks";
import { localTicket } from "../lib/localShow";
import { onOpenedShow, takeOpenedShow } from "../lib/openedShow";
import {
  exportChoices, importPack, packFileName, packShow, readPack,
  type ExportChoice, type PackProgress, type ReadPack,
} from "../lib/showPack";
import type { Role, Show } from "../lib/shows";
import type { Sequence, Track } from "../types";

/**
 * Taking a show somewhere, and bringing one back.
 *
 * Both halves live in one file because they are one idea and the wording has to match: what the
 * export says it is putting in the file is exactly what the import says it found. They drifted
 * when they were two screens.
 */

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately cancels the download in some browsers, so let the click settle first.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The sequences this show carries: its own deck, plus anything dropped onto it afterwards. */
function sequencesFor(show: Show, extra: string | null): Sequence[] {
  const all = local.get<Sequence[]>(scopedKey("sequences"), []);
  const wanted = new Set([show.sequenceId, extra, ...linksOf(loadLinks(currentProject()), show.id).seqs].filter((id): id is string => !!id));
  const picked = all.filter(s => wanted.has(s.id));
  // A show with nothing linked yet is still worth exporting; taking every sequence in the project
  // is a bigger file and a working one, where taking none is a download of an empty cue list.
  return picked.length ? picked : all;
}

/* ── out ─────────────────────────────────────────────────────────────────────────────────── */

export function ShowExport({ show, roles, sequenceId }: { show: Show; roles: Role[]; sequenceId: string }) {
  const choices = useMemo(() => exportChoices(roles), [roles]);
  const [pick, setPick] = useState<string>("host");
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen: ExportChoice = choices.find(c => c.key === pick) ?? choices[0];

  const go = async () => {
    setBusy(true);
    setProgress(null);
    try {
      const sequences = sequencesFor(show, sequenceId || null);
      const script = linksOf(loadLinks(currentProject()), show.id).script ? loadScript() : null;
      const { blob, missing } = await packShow({
        show,
        roles,
        sequences,
        tracks: local.get<Track[]>(scopedKey("tracks"), []),
        script,
        role: chosen.role,
        onProgress: setProgress,
      });
      save(blob, packFileName(show.name, chosen.role));
      toast(
        `${show.name} packed, ${size(blob.size)}`,
        missing.length
          ? `${missing.length} file${missing.length === 1 ? "" : "s"} could not be read and ${missing.length === 1 ? "is" : "are"} not in it: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}. Everything else is.`
          : "Open it on any other device, or bake it into an installer. Nothing in it needs an account.",
        missing.length ? "warn" : "success",
      );
    } catch (error) {
      toast("The show could not be packed", (error as Error).message, "warn");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section className="space-y-3 border-t border-white/10 pt-4">
      <h3 className="flex items-center gap-2 text-body font-bold"><Package size={16} className="text-accent" />Take this show somewhere</h3>
      <p className="text-label text-muted">
        One file with the whole show in it: the cues, the sequences, the script and every sound and
        picture. Give it to another device and that device runs the show with no account, no code to
        type and no internet. Cut one per job, so the screen in the foyer gets a file that can only
        be a screen.
      </p>

      <div role="radiogroup" aria-label="What this copy can do" className="flex flex-wrap gap-1.5">
        {choices.map(c => (
          <button key={c.key} type="button" role="radio" aria-checked={pick === c.key} onClick={() => setPick(c.key)}
            className={`min-h-11 rounded-md border px-3 text-body transition-colors ${
              pick === c.key ? "border-accent bg-accent/12 font-semibold text-foreground" : "border-white/15 text-muted hover:text-foreground"}`}>
            {c.name}
          </button>
        ))}
      </div>
      <p className="text-label text-muted">{chosen.hint}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button color="primary" size="sm" className="min-h-11" isLoading={busy} startContent={<Download size={15} />} onPress={() => void go()}>
          Export {chosen.key === "host" ? "the whole show" : chosen.name}
        </Button>
        {progress && (
          <span className="text-label text-muted" role="status">
            {progress.done} of {progress.total}: {progress.title}
          </span>
        )}
      </div>

      <details className="rounded-xl bg-white/5 p-3">
        <summary className="cursor-pointer text-body font-medium">Turn it into its own app</summary>
        <div className="mt-2 space-y-2 text-label text-muted">
          <p>
            The file above opens in the installed app and on the website. If you would rather hand
            somebody one installer that already <em>is</em> the show, the repository builds those:
            put the exported file into the build and the app opens straight into this production, in
            this job, with nothing to type.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-2 font-mono text-micro text-foreground">node scripts/bake-show.mjs {packFileName(show.name, chosen.role)}
npm run tauri build</pre>
          <p>
            Or run the <b>custom-app</b> workflow on GitHub, which builds the Windows installer and
            the Android APK for you. It takes a link to the file, so put it somewhere reachable
            first.
          </p>
        </div>
      </details>
    </section>
  );
}

/* ── in ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Opening a show somebody sent you.
 *
 * Deliberately two presses. The first reads the file and says what is in it and what job it gives
 * this device; the second writes it. An import that has already happened by the time you are told
 * what it was is not a decision, and this is a file that arrived by email.
 */
export function ShowImport({ onDone, compact }: { onDone?: (showId: string) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<ReadPack | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const look = async (file: File) => {
    setBusy(true);
    try {
      const read = await readPack(file);
      setPack(read);
      setName(file.name);
    } catch (error) {
      toast("That file would not open", (error as Error).message, "warn");
      setPack(null);
    } finally { setBusy(false); }
  };

  const take = async () => {
    if (!pack) return;
    setBusy(true);
    try {
      const result = await importPack(pack, { name: localStorage.getItem("cueflow:showName")?.trim() || "" });
      // The ticket is what every show screen reads. Writing it here is what makes an imported pack
      // open straight into the job it was cut for instead of at the door asking for a key.
      const ticket = localTicket(result.member);
      if (ticket) local.set("ticket", ticket);
      toast(
        `${pack.body.show.name} is on this device`,
        [
          result.assets ? `${result.assets} file${result.assets === 1 ? "" : "s"} stored here` : "No media in it",
          pack.manifest.role ? `you are on ${pack.manifest.role.name}` : "you have the whole show",
          result.renamed ? `its key is now ${result.showId}, because the old one was taken` : `its key is ${result.showId}`,
        ].join(", ") + ".",
        result.missing.length ? "warn" : "success",
      );
      if (result.missing.length) {
        toast(`${result.missing.length} file${result.missing.length === 1 ? "" : "s"} did not come with it`, `${result.missing.slice(0, 3).join(", ")}${result.missing.length > 3 ? "…" : ""}. Those cues will be silent here.`, "warn");
      }
      setPack(null);
      onDone?.(result.showId);
    } catch (error) {
      toast("The show was not imported", (error as Error).message, "warn");
    } finally { setBusy(false); }
  };

  /**
   * A file the operating system handed over, which is the whole point of registering for the file
   * type. Both halves are needed: one already parked before this mounted, and one that arrives
   * while it is open, because an installed app is reused rather than relaunched for a second file.
   */
  useEffect(() => {
    const parked = takeOpenedShow();
    if (parked) void look(parked);
    return onOpenedShow(file => void look(file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void look(file);
  };

  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      {!compact && <h3 className="flex items-center gap-2 text-body font-bold"><HardDriveDownload size={16} className="text-accent" />Open a show you were sent</h3>}
      <input ref={input} type="file" accept=".cueflow,.zip,application/zip" className="hidden"
        onChange={e => { const file = e.target.files?.[0]; if (file) void look(file); e.target.value = ""; }} />

      {!pack && (
        <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
          className={`rounded-2xl border border-dashed p-4 text-center transition-colors ${over ? "border-accent bg-accent/10" : "border-white/20"}`}>
          <Button size="sm" className="min-h-11" variant="flat" isLoading={busy} startContent={<Upload size={15} />} onPress={() => input.current?.click()}>
            Choose a show file
          </Button>
          <p className="mt-2 text-label text-muted">Or drop it here. A <span className="font-mono">.cueflow</span> file holds the whole show and the job it gives this device.</p>
        </div>
      )}

      {pack && (
        <div className="space-y-3 rounded-2xl bg-white/5 p-4">
          <div className="flex items-start gap-3">
            <Box size={18} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <p className="text-body font-semibold">{pack.body.show.name}</p>
              <p className="text-label text-muted">{name}</p>
            </div>
          </div>
          <ul className="space-y-1 text-label text-muted">
            <li><b className="text-foreground">{pack.manifest.role ? pack.manifest.role.name : "Everything"}</b> {pack.manifest.role ? "is the job this copy gives this device." : "is what this copy gives you: it runs the show."}</li>
            <li>{pack.body.sequences.length} sequence{pack.body.sequences.length === 1 ? "" : "s"}, {pack.body.tracks.length} cue file{pack.body.tracks.length === 1 ? "" : "s"}, {pack.manifest.assets.length} stored here ({size(pack.manifest.assets.reduce((n, a) => n + a.bytes, 0))}).</li>
            <li>{pack.body.script?.html ? "It carries a script, which is taken only if this device has none." : "No script in it."}</li>
            <li>Made {new Date(pack.manifest.created).toLocaleDateString()}. Nothing here is uploaded anywhere.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button color="primary" size="sm" className="min-h-11" isLoading={busy} onPress={() => void take()}>Put it on this device</Button>
            <Button size="sm" variant="light" className="min-h-11" isDisabled={busy} onPress={() => setPack(null)}>Cancel</Button>
            {busy && <Spinner size="sm" />}
          </div>
        </div>
      )}
    </section>
  );
}
