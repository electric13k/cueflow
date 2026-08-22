import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import Page, { Section } from "../components/Page";

const UPDATED = "22 August 2026";

export default function Privacy() {
  return (
    <Page width="max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Legal</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">
        Last updated {UPDATED}. See also the{" "}
        <Link to="/terms" className="text-accent underline-offset-2 hover:underline">Terms of Service</Link>.
      </p>

      <div className="glass mt-10 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><ShieldCheck size={20} className="text-accent" />What we hold</h2>

        <Section title="The short version">
          No ads and no sale of personal data. Necessary storage keeps CueFlow working. Optional analytics is off by default and is used only after you choose to allow it. CueFlow does not use analytics to read your scripts, media files, passwords, access tokens, or private project content.
        </Section>

        <Section title="What is stored on your device">
          Your media references, sequences, keybinds, scripts, editor preferences, alert scope, and interface preferences are saved in this browser's local storage under keys beginning <code className="rounded bg-white/10 px-1">cueflow:</code>. A first-party cookie records your optional analytics choice. A service worker may cache the public application shell and static assets, but it does not intentionally cache authentication tokens, private project records, or uploaded media. If you sign in, Supabase session storage keeps you signed in. Clearing your browser data removes the local copy and consent choice.
        </Section>

        <Section title="Optional analytics">
          <p>Analytics is disabled unless you choose <b>Allow analytics</b>. If enabled, CueFlow may receive aggregated route visits, feature interactions, performance timings, and error counts to help improve the product. It is not intended to receive script contents, media files, passwords, access tokens, or private project records. You can choose <b>Only necessary</b> at the banner or change the choice later in <Link to="/settings" className="text-accent underline-offset-2 hover:underline">Settings</Link>.</p>
        </Section>

        <Section title="What is stored on the server">
          <p>Accounts and cue data are held by <b>Supabase</b> (our hosting and database provider). If you sign in, we store your email address, your asset and sequence metadata, and nothing else about you. Passwords are handled by Supabase Auth and are never visible to CueFlow.</p>
          <p><b>Uploaded files are stored in a public storage bucket.</b> Their URLs are long and random and are not listed anywhere, but they are not access-controlled, anyone holding a file's URL can open it. Treat uploads as unlisted, not private, and do not upload confidential recordings, images or slides.</p>
        </Section>

        <Section title="Imports and searches">
          <p>Importing by link sends that URL to this site's server, which fetches the file and stores it for you. The URL is not logged or retained by CueFlow beyond that request.</p>
          <p>Searching the Internet Archive or Wikimedia Commons sends your query straight from your browser to those services, under their own privacy policies. Searching Myinstants opens their site in a new tab, at which point you are on their site.</p>
          <p>An embedded Google Slides or PowerPoint deck loads directly from that provider in the presenter window, so that provider sees the request.</p>
          <p>Optional analytics, when enabled by you, is processed as aggregated product telemetry. It is not a requirement for using CueFlow, and it can be disabled at any time.</p>
        </Section>

        <Section title="The contact form">
          A message sent from the contact form is delivered to a private Slack channel, along with the reply address you gave (or your account email, if you were signed in). It is not stored anywhere else.
        </Section>

        <Section title="Hosting logs">
          The site is served by <b>Cloudflare Pages</b>, with mirror deployments on <b>Vercel</b> where available. Hosting providers may keep standard request logs such as IP address, timestamp, requested URL, and response status for security and abuse prevention under their own privacy policies. CueFlow does not use those logs for advertising.
        </Section>

        <Section title="How long it is kept" id="retention">
          <p><b>Uploaded without an account: 30 days.</b> A file uploaded by a visitor who is not signed in is deleted 30 days after it lands. There is no account to warn and no address to warn it at, which is exactly why the window is short. Sign in before you upload anything you want to keep.</p>
          <p><b>With an account: one year of inactivity.</b> Opening CueFlow while signed in resets that clock for another year. If an account goes a whole year untouched, its files, sequences, shows, scripts and login are deleted, and that cannot be undone.</p>
          <p><b>One email, a month before.</b> At eleven months of silence we email the address on the account once, with the deletion date, a link that keeps everything (opening CueFlow), and a link that downloads all of it as a zip. Coming back at any point before the date cancels the deletion.</p>
          <p>The export lives on your <Link to="/account" className="text-accent underline-offset-2 hover:underline">account page</Link> and needs no notice to use: your files under their own names, and your cue data as plain JSON that opens without CueFlow.</p>
        </Section>

        <Section title="Your rights">
          You can export or delete your data at any time: the account page hands you a zip of everything, signing out and clearing browser data removes the local copy, and the <Link to="/contact" className="text-accent underline-offset-2 hover:underline">contact form</Link> has your account and its server-side records deleted on request. If you are in the UK/EU, the usual GDPR rights (access, correction, erasure, portability, objection) apply.
        </Section>

        <Section title="Children">
          CueFlow is not aimed at children under 13, and accounts should not be created by them.
        </Section>
      </div>
    </Page>
  );
}
