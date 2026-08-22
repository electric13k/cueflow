import { Link } from "react-router-dom";
import { Cookie } from "lucide-react";
import Page, { Section } from "../components/Page";

const UPDATED = "22 August 2026";

export default function Cookies() {
  return (
    <Page width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Legal</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Cookies and local storage</h1>
      <p className="mt-2 text-sm text-muted">
        Last updated {UPDATED}. See also the <Link to="/privacy" className="text-accent underline-offset-2 hover:underline">Privacy Policy</Link> and <Link to="/terms" className="text-accent underline-offset-2 hover:underline">Terms of Service</Link>.
      </p>

      <div className="glass mt-10 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><Cookie size={20} className="text-accent" />How CueFlow stores information</h2>

        <Section title="Necessary storage">
          CueFlow uses first-party local storage for media references, sequences, scripts, keybinds, layout preferences, theme preferences, tutorial state, and demo ownership markers. A first-party cookie stores the analytics preference. Authentication may use Supabase session storage when you sign in. These mechanisms are required for the application to operate and are not used for advertising.
        </Section>

        <Section title="Optional analytics">
          Optional analytics is disabled by default. If you choose Allow analytics, CueFlow may record aggregated product-use events such as route visits, feature interactions, performance timing, and error counts. It is not intended to store script contents, media files, passwords, access tokens, or the contents of private project data. CueFlow does not sell this information or use it for targeted advertising.
        </Section>

        <Section title="Your choice">
          You can choose Only necessary or Allow analytics in the consent notice. You can change the decision later from Settings. Choosing Only necessary does not disable the cue board, script reader, media editors, show controls, sign-in, or local project storage. Clearing site data also clears the local preference and shows the notice again.
        </Section>

        <Section title="Cache and service worker">
          CueFlow may cache the public application shell and static assets so the interface starts quickly and can recover from a brief network interruption. The cache does not intentionally store authentication tokens, private project records, or uploaded media. A new application version invalidates the old shell cache. Browser cache controls and site-data deletion remain available through your browser.
        </Section>

        <Section title="Third-party services">
          Supabase handles authentication and account synchronization when you use those features. Cloudflare Pages and Vercel may process standard hosting requests and logs. External media searches and embedded presentations are loaded under the third party's own terms and privacy policy. Optional analytics is not enabled until you make an affirmative choice.
        </Section>

        <Section title="Contact">
          If you have a question about storage or consent, use the <Link to="/contact" className="text-accent underline-offset-2 hover:underline">contact form</Link>. This page is a plain-language product disclosure and should be reviewed for the jurisdictions where CueFlow is offered.
        </Section>
      </div>
    </Page>
  );
}
