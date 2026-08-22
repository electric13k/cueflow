import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import Page, { Section } from "../components/Page";

const UPDATED = "22 August 2026";

export default function Terms() {
  return (
    <Page width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Legal</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted">
        Last updated {UPDATED}. CueFlow is a hobby project offered free of charge. See also the{" "}
        <Link to="/privacy" className="text-accent underline-offset-2 hover:underline">Privacy Policy</Link>.
      </p>

      <div className="glass mt-10 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><FileText size={20} className="text-accent" />The agreement</h2>

        <Section title="Using CueFlow">
          CueFlow is a browser-based cue player for sound, slides and video. You may use it for personal, educational, community or commercial performances. You need a modern browser; nothing is installed on your machine.
        </Section>

        <Section title="Your account">
          An account is optional, CueFlow works without one. If you create one, keep your password to yourself; you are responsible for what happens under your account. You can sign out at any time, and you can ask for your account and its data to be deleted (see Privacy). Optional analytics is controlled by your consent and can be turned off in Settings.
        </Section>

        <Section title="The media you upload">
          <p>You keep all rights to the audio, images and video you upload. By uploading, you confirm you have the right to use that media, and you grant CueFlow only the permission needed to store it and play it back to you.</p>
          <p><b>Do not upload anything you are not licensed to use, anything illegal, or anything you would mind a stranger seeing or hearing</b>, see the storage note in the Privacy Policy for why that last part matters.</p>
        </Section>

        <Section title="Imports and third-party media" id="imports">
          <p>CueFlow can fetch a file from a public link you paste, and can search the <b>Internet Archive</b> and <b>Wikimedia Commons</b>, which host public-domain and freely licensed recordings. Licences there vary by item; several require attribution. Checking the licence of anything you perform publicly is on you.</p>
          <p>The Myinstants search opens myinstants.com in a new tab. Those sounds belong to their respective owners and are subject to Myinstants' own terms.</p>
          <p><b>CueFlow does not download or convert media from YouTube, YouTube Music, Spotify, Apple Music or similar streaming services.</b> Those services' terms prohibit it, their catalogues are licensed rather than free to redistribute, and the protected ones cannot be extracted without circumventing access controls. Import your own files, or use the freely licensed sources above.</p>
        </Section>

        <Section title="Embedded decks">
          A Google Slides or PowerPoint Online link is embedded, not copied: the deck stays on that service, under that service's terms, and is visible to anyone who can reach the link you shared.
        </Section>

        <Section title="Cookies and analytics">
          <p>Necessary browser storage supports the cue board, local projects, script reader, editors, preferences, authentication, and cache. Optional analytics is off by default and is enabled only when you choose Allow analytics. You can choose Only necessary or change the choice later in <RouterLink to="/settings" className="text-accent underline-offset-2 hover:underline">Settings</RouterLink>. See the <RouterLink to="/cookies" className="text-accent underline-offset-2 hover:underline">Cookies policy</RouterLink> for details.</p>
        </Section>

        <Section title="No warranty">
          CueFlow is provided "as is", with no guarantee that it will be available, bug-free, or fit for your particular show. Do not rely on it as the only copy of anything you care about, and keep a backup of critical media. To the extent the law allows, the project and its author are not liable for any loss arising from your use of it.
        </Section>

        <Section title="Changes and termination">
          These terms may change; the date at the top will tell you when. Accounts that are used to distribute illegal material or to abuse the service may be removed.
        </Section>
      </div>
    </Page>
  );
}
