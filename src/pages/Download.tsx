import { useMemo, useRef } from "react";
import { Bluetooth, Download as DownloadIcon, ShieldAlert, Wifi } from "lucide-react";
import Page, { Section } from "../components/Page";
import { Button } from "../ui";
import { useReveal } from "../lib/motion";

/**
 * The one link on this page that is allowed to be a URL.
 *
 * `/releases/latest` always resolves to the newest tag, so it survives every version bump.
 * A per-platform deep link would not: GitHub's `/releases/latest/download/<name>` needs the exact
 * asset name, and Tauri stamps the version into every one of them, so `CueFlow_0.1.0_x64-setup.exe`
 * becomes a 404 the day 0.1.1 ships. Hence one link for everybody, and each platform's file named
 * by its ending so a visitor knows which row to press.
 */
const RELEASES = "https://github.com/electric13k/cueflow/releases/latest";

export type PlatformId = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

/** What a browser can tell us about itself. Both fields are optional; older browsers ship neither. */
export type PlatformHint = { userAgent?: string; platform?: string };

/**
 * Which build to lead with.
 *
 * `navigator.userAgentData.platform` is read first because Chrome and Edge now freeze most of the
 * user agent string, and the hint is the part that is still allowed to be specific. The string is
 * the fallback, since Safari and Firefox ship no hints at all.
 *
 * The order of the string tests is load-bearing. An iPhone says "like Mac OS X" and an Android
 * phone says "Linux", so the narrow test has to run before the broad one or every phone in the
 * building is offered a desktop installer.
 */
export function detectPlatform(hint: PlatformHint = {}): PlatformId {
  const hinted = (hint.platform ?? "").trim().toLowerCase();
  if (hinted === "windows") return "windows";
  if (hinted === "macos") return "macos";
  if (hinted === "android") return "android";
  if (hinted === "ios") return "ios";
  // Chrome OS runs Android apps and Debian packages, so it belongs with Linux rather than nowhere.
  if (hinted === "linux" || hinted === "chrome os" || hinted === "chromium os") return "linux";

  const ua = hint.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "unknown";
}

/** Reading `navigator` is the impure half, kept out of `detectPlatform` so the rules stay testable. */
function readPlatformHint(): PlatformHint {
  if (typeof navigator === "undefined") return {};
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return { userAgent: navigator.userAgent, platform: data?.platform };
}

type Build = {
  id: PlatformId;
  name: string;
  /** Empty when the workflow produces nothing for this platform. */
  file: string;
  what: string;
};

/**
 * Exactly what `.github/workflows/native-release.yml` attaches to a release, and nothing else.
 *
 * The desktop matrix is `windows-latest` and `ubuntu-22.04`, so no macOS runner ever runs and no
 * `.dmg` is ever built, whatever `tauri.conf.json` lists as a bundle target. Offering one would be
 * a link to a file that is not there.
 */
const BUILDS: Build[] = [
  {
    id: "windows", name: "Windows", file: "the file ending in -setup.exe",
    what: "There is an .msi next to it if your organisation deploys that way; the setup .exe is the one to take otherwise. 64-bit Windows 10 and 11.",
  },
  {
    id: "linux", name: "Linux", file: "the .AppImage, or the .deb on Debian and Ubuntu",
    what: "Mark the AppImage executable and run it, no install needed. Built on Ubuntu 22.04, so an older distribution may be short of the glibc and WebKitGTK it wants.",
  },
  {
    id: "android", name: "Android", file: "the .apk",
    what: "Android blocks installs from outside the Play Store until you allow them for whichever app hands over the file, in Settings, Apps, Special app access. A phone joins the mesh; it cannot host the Bluetooth half of it.",
  },
  {
    id: "macos", name: "macOS", file: "",
    what: "No build. The release workflow compiles on Windows and Ubuntu only, so there is no .dmg to give you. A Mac can build it from source: clone the repository and run npm run tauri build.",
  },
  {
    id: "ios", name: "iPhone and iPad", file: "",
    what: "No build, and not one that is coming soon. It would need a paid Apple Developer account and App Store review, and the Bluetooth host role has the same missing-crate problem it has on Android. Use the website in Safari instead; everything except the offline mesh works there.",
  },
];

const byId = (id: PlatformId) => BUILDS.find(b => b.id === id);

export default function Download() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  // Read once. The answer cannot change while the page is open, and re-reading on every render
  // would make the lead card flicker between builds during a Strict Mode double render.
  const platform = useMemo(() => detectPlatform(readPlatformHint()), []);
  const lead = byId(platform);
  const others = BUILDS.filter(b => b.id !== platform);

  return (
    <Page width="max-w-3xl"><div ref={root}>
      <p className="eyebrow text-accent">Native app</p>
      <h1 className="mt-2 text-title font-semibold tracking-tight sm:text-banner">Download CueFlow</h1>
      <p className="mt-2 text-lead text-muted">
        The desktop and Android app runs a show over a mesh between the devices in the room, with no
        router, no account and no internet. Everything else happens on the website.
      </p>

      <div data-reveal className="glass mt-10 p-6 sm:p-8">
        {lead ? (
          <>
            <p className="label-cap text-muted">Looks like {lead.name}</p>
            <h2 className="mt-2 flex items-center gap-2 text-heading font-semibold tracking-tight">
              <DownloadIcon size={20} className="text-accent" />
              {lead.file ? `On the release page, take ${lead.file}` : `There is no ${lead.name} build`}
            </h2>
            <p className="mt-2 text-body text-muted">{lead.what}</p>
          </>
        ) : (
          <>
            <p className="label-cap text-muted">Platform not recognised</p>
            <h2 className="mt-2 flex items-center gap-2 text-heading font-semibold tracking-tight">
              <DownloadIcon size={20} className="text-accent" />Pick your own file
            </h2>
            <p className="mt-2 text-body text-muted">
              Your browser did not say what it is running on, so every build is listed below. Take the
              one that matches the machine you are on.
            </p>
          </>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button href={RELEASES} target="_blank" color="primary" size="lg" startContent={<DownloadIcon size={18} />}>
            Open the latest release
          </Button>
          <span className="text-micro text-muted">Every installer, every platform, newest version.</span>
        </div>
      </div>

      <div data-reveal className="glass mt-6 p-6 sm:p-8">
        <h2 className="text-heading font-semibold tracking-tight">{lead ? "The other platforms" : "Every platform"}</h2>
        <ul className="mt-4">
          {others.map(b => (
            <li key={b.id} className="border-t border-border py-4 first:border-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-bold text-foreground">{b.name}</span>
                <span className="rounded-full bg-surface/70 px-2 py-0.5 text-micro font-semibold text-muted">
                  {b.file || "No build"}
                </span>
              </div>
              <p className="mt-1 text-body text-muted">{b.what}</p>
            </li>
          ))}
        </ul>
      </div>

      <div data-reveal className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-heading font-semibold tracking-tight">
          <ShieldAlert size={20} className="text-accent" />Before you run it
        </h2>

        <Section title="Nothing here is code-signed">
          <p>
            A code-signing certificate costs more per year than this project spends in total, so the
            installers carry no signature. Windows SmartScreen will put up a blue box saying it
            protected your PC. Press <b>More info</b>, then <b>Run anyway</b>. That is the whole
            ritual, and it is the same for every unsigned installer on the internet.
          </p>
          <p>
            The same applies on macOS if you build it yourself: Gatekeeper refuses an unsigned app on
            a double click, so right-click the app, choose <b>Open</b>, and confirm, or allow it once
            under System Settings, Privacy and Security.
          </p>
          <p>
            Do this the day before, not twenty minutes before the house opens. A scary dialog you
            were not warned about is the thing that stops a show, and you can check the files against
            the workflow that built them: every release is compiled in public by GitHub Actions from
            the tagged commit.
          </p>
        </Section>

        <Section title="Android asks a second question">
          The APK comes from a release, not from the Play Store, so Android will refuse it until you
          allow installs from whichever app is handing over the file. If a release was cut without
          the signing secrets in place, the APK is a debug build; a later signed release cannot then
          upgrade it in place, because Android will not accept an update signed with a different key.
          Uninstall and reinstall in that case.
        </Section>
      </div>

      <div data-reveal className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-heading font-semibold tracking-tight">
          <Wifi size={20} className="text-accent" />Why this exists at all
        </h2>

        <Section title="A browser cannot mesh">
          <p>
            Web Bluetooth gives a page the GATT client role and nothing more. A tab cannot advertise
            and cannot host a GATT server, so two browsers can never reach each other that way, no
            matter how close together they are sitting. A page served over https cannot open a socket
            to a bare address on the local network either; that is mixed content, and it is blocked.
          </p>
          <p>
            So a venue with no internet needs something that is not a browser. That is all this app
            is. Plan the show, cut the audio, build the deck and rehearse on the website; install this
            only for the room where the network is a rumour.
          </p>
        </Section>

        <Section title="What it does that the site cannot">
          The devices in the room find each other over Bluetooth and Wi-Fi and call the show between
          themselves. One mesh, not two: a cue sent over Wi-Fi reaches a phone that is only on
          Bluetooth, because the app floods what it hears from one radio onto the other. There is no
          router to set up, no account to sign into and no internet at any point.
        </Section>
      </div>

      <div data-reveal className="glass mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-heading font-semibold tracking-tight">
          <Bluetooth size={20} className="text-accent" />What is still missing
        </h2>

        <Section title="Android joins the Bluetooth mesh, it cannot host it">
          <p>
            Hosting over Bluetooth means holding an advertiser and a GATT server. On Android those are
            Java classes, and no Rust crate reaches them: btleplug is client-only and says so,
            ble-peripheral-rust has no Android backend, and bluster is BlueZ alone. Closing that gap
            means writing a Kotlin plugin, and it is not written.
          </p>
          <p>
            So put a laptop in the room and let it be the Bluetooth host. Phones join it and relay.
            Over Wi-Fi none of this applies: every device is a full peer, phones included. A
            phone-only room is the case that does not work yet; a normal room works.
          </p>
          <p>
            Bluetooth also holds roughly seven connections per host, fewer on some hardware, which is
            why cues are hop counted. A room bigger than that needs a second device relaying.
          </p>
        </Section>
      </div>
    </div></Page>
  );
}
