import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { FileText, ShieldCheck } from "lucide-react";
import Backdrop from "../components/Backdrop";
import Nav from "../components/Nav";

const UPDATED = "2 August 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="text-base font-bold">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function Legal() {
  const { hash } = useLocation();
  // Deep links like /legal#privacy should land on that heading.
  useEffect(() => { if (hash) document.querySelector(hash)?.scrollIntoView({ behavior: "smooth" }); }, [hash]);

  return (
    <div className="relative min-h-screen">
      <Backdrop />
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-accent">Legal</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Terms & Privacy</h1>
        <p className="mt-2 text-sm text-muted">Last updated {UPDATED}. CueFlow is a hobby project offered free of charge.</p>

        <div id="terms" className="glass mt-10 scroll-mt-20 p-6 sm:p-8">
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><FileText size={20} className="text-accent" />Terms of Service</h2>

          <Section title="Using CueFlow">
            CueFlow is a browser-based soundboard and cue player. You may use it for personal, educational, community or commercial performances. You need a modern browser; nothing is installed on your machine.
          </Section>

          <Section title="Your account">
            An account is optional — CueFlow works without one. If you create one, keep your password to yourself; you are responsible for what happens under your account. You can sign out at any time, and you can ask for your account and its data to be deleted (see Privacy below).
          </Section>

          <Section title="The audio you upload">
            <p>You keep all rights to the audio you upload. By uploading, you confirm you have the right to use that audio, and you grant CueFlow only the permission needed to store it and play it back to you.</p>
            <p><b>Do not upload anything you are not licensed to use, anything illegal, or anything you would mind a stranger hearing</b> — see the storage note in the Privacy Policy for why that last part matters.</p>
          </Section>

          <Section title="Third-party sounds">
            The Myinstants import fetches audio from myinstants.com. Those sounds belong to their respective owners and are subject to Myinstants' own terms — clearing rights for anything you perform publicly is on you.
          </Section>

          <Section title="No warranty">
            CueFlow is provided "as is", with no guarantee that it will be available, bug-free, or fit for your particular show. Do not rely on it as the only copy of anything you care about, and keep a backup of critical audio. To the extent the law allows, the project and its author are not liable for any loss arising from your use of it.
          </Section>

          <Section title="Changes and termination">
            These terms may change; the date at the top will tell you when. Accounts that are used to distribute illegal material or to abuse the service may be removed.
          </Section>
        </div>

        <div id="privacy" className="glass mt-8 scroll-mt-20 p-6 sm:p-8">
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><ShieldCheck size={20} className="text-accent" />Privacy Policy</h2>

          <Section title="The short version">
            No ads. No analytics. No third-party trackers. No selling or sharing of your data. CueFlow collects the minimum it needs to work.
          </Section>

          <Section title="What is stored on your device">
            Your sounds, sequences, keybinds and interface preferences are saved in this browser's local storage under keys beginning <code className="rounded bg-white/10 px-1">cueflow:</code>. A cookie records whether you dismissed the cookie notice. If you sign in, your session token is stored so you stay signed in. Clearing your browser data removes all of it.
          </Section>

          <Section title="What is stored on the server">
            <p>Accounts and cue data are held by <b>Supabase</b> (our hosting and database provider). If you sign in, we store your email address, your track and sequence metadata, and nothing else about you. Passwords are handled by Supabase Auth and are never visible to CueFlow.</p>
            <p><b>Uploaded audio files are stored in a public storage bucket.</b> Their URLs are long and random and are not listed anywhere, but they are not access-controlled — anyone holding a file's URL can play it. Treat uploads as unlisted, not private, and do not upload confidential recordings.</p>
          </Section>

          <Section title="Requests to Myinstants">
            When you search Myinstants, your query is sent through this site's server to myinstants.com. The query is not logged or retained by CueFlow.
          </Section>

          <Section title="Hosting logs">
            The site is served by Netlify, which keeps standard request logs (IP address, timestamp, requested URL) for security and abuse prevention, under its own privacy policy. CueFlow does not read them for any other purpose.
          </Section>

          <Section title="Your rights">
            You can export or delete your data at any time: sign out and clear browser data to remove the local copy, and email the address below to have your account and its server-side records deleted. If you are in the UK/EU, the usual GDPR rights (access, correction, erasure, portability, objection) apply.
          </Section>

          <Section title="Children">
            CueFlow is not aimed at children under 13, and accounts should not be created by them.
          </Section>

          <Section title="Contact">
            Questions, or a deletion request: <a className="text-accent" href="mailto:electric13k@gmail.com">electric13k@gmail.com</a>.
          </Section>
        </div>
      </main>
    </div>
  );
}
