import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import Page, { Section } from "../components/Page";

const UPDATED = "3 August 2026";

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
          No ads. No analytics. No third-party trackers. No selling or sharing of your data. CueFlow collects the minimum it needs to work.
        </Section>

        <Section title="What is stored on your device">
          Your media, sequences, keybinds and interface preferences are saved in this browser's local storage under keys beginning <code className="rounded bg-white/10 px-1">cueflow:</code>. A cookie records whether you dismissed the cookie notice. If you sign in, your session token is stored so you stay signed in. Clearing your browser data removes all of it.
        </Section>

        <Section title="What is stored on the server">
          <p>Accounts and cue data are held by <b>Supabase</b> (our hosting and database provider). If you sign in, we store your email address, your asset and sequence metadata, and nothing else about you. Passwords are handled by Supabase Auth and are never visible to CueFlow.</p>
          <p><b>Uploaded files are stored in a public storage bucket.</b> Their URLs are long and random and are not listed anywhere, but they are not access-controlled, anyone holding a file's URL can open it. Treat uploads as unlisted, not private, and do not upload confidential recordings, images or slides.</p>
        </Section>

        <Section title="Imports and searches">
          <p>Importing by link sends that URL to this site's server, which fetches the file and stores it for you. The URL is not logged or retained by CueFlow beyond that request.</p>
          <p>Searching the Internet Archive or Wikimedia Commons sends your query straight from your browser to those services, under their own privacy policies. Searching Myinstants opens their site in a new tab, at which point you are on their site.</p>
          <p>An embedded Google Slides or PowerPoint deck loads directly from that provider in the presenter window, so that provider sees the request.</p>
        </Section>

        <Section title="The contact form">
          A message sent from the contact form is delivered to a private Slack channel, along with the reply address you gave (or your account email, if you were signed in). It is not stored anywhere else.
        </Section>

        <Section title="Hosting logs">
          The site is served by <b>Netlify</b>, with a mirror deployment on <b>Vercel</b>. Both keep standard request logs (IP address, timestamp, requested URL) for security and abuse prevention, under their own privacy policies. CueFlow does not read them for any other purpose.
        </Section>

        <Section title="Your rights">
          You can export or delete your data at any time: sign out and clear browser data to remove the local copy, and use the <Link to="/contact" className="text-accent underline-offset-2 hover:underline">contact form</Link> to have your account and its server-side records deleted. If you are in the UK/EU, the usual GDPR rights (access, correction, erasure, portability, objection) apply.
        </Section>

        <Section title="Children">
          CueFlow is not aimed at children under 13, and accounts should not be created by them.
        </Section>
      </div>
    </Page>
  );
}
